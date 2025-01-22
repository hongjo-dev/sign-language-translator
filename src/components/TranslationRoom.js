import React, { useEffect, useState, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import io from 'socket.io-client';
import './TranslationRoom.css';

// 환경변수에서 필요한 값들을 꺼내옵니다.
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const STUN_SERVER = process.env.REACT_APP_STUN_SERVER || 'stun:stun.l.google.com:19302';

function TranslationRoom() {
  const { roomCode } = useParams();
  const location = useLocation();
  const { roomName, userName, role } = location.state || {};

  const [stream, setStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordedVideo, setRecordedVideo] = useState(null);
  const [users, setUsers] = useState([]);
  const [videoQueue, setVideoQueue] = useState([]);
  const [translatedVideos, setTranslatedVideos] = useState([]);
  const [remoteRecording, setRemoteRecording] = useState(false);
  const [remoteRecordedVideo, setRemoteRecordedVideo] = useState(null);

  const videoRef = useRef(null);
  const videoContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const socketRef = useRef();
  const mediaRecorderRef = useRef(null);
  const peerConnections = useRef({});
  const recordedChunks = useRef([]);
  const videoElementRef = useRef(null);
  const remoteMediaRecorderRef = useRef(null);
  const remoteRecordedChunks = useRef([]);

  // STUN 서버 설정
  const ICE_SERVERS = {
    iceServers: [{ urls: STUN_SERVER }],
  };

  useEffect(() => {
    // 소켓 서버 연결
    socketRef.current = io.connect(SOCKET_URL, {
      secure: true,
      reconnection: true,
      rejectUnauthorized: false,
    });

    // 방 참가
    socketRef.current.emit('join room', { roomCode, userName, role });

    // 소켓 이벤트 리스너 등록
    socketRef.current.on('message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socketRef.current.on('translated message', (message) => {
      setMessages((prevMessages) => {
        const updatedMessages = prevMessages.map((msg) =>
          msg.text === message.originalText
            ? { ...msg, translatedText: message.text, videoPath: message.videoPath }
            : msg
        );
        return updatedMessages;
      });
      // 번역된 텍스트로부터 수어 영상 재생
      handleTranslatedMessage(message.text);
    });

    socketRef.current.on('translated sign message', (message) => {
      setMessages((prev) => [
        ...prev,
        {
          userName: '수어 번역',
          text: message.text,
          originalText: message.originalText,
          role: 'sign-translation',
        },
      ]);
    });

    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);

    socketRef.current.on('update user list', (userList) => {
      setUsers(userList);
    });

    socketRef.current.on('user-disconnected', (peerId) => {
      if (remoteStreams[peerId]) {
        setRemoteStreams((prevRemoteStreams) => {
          const updatedStreams = { ...prevRemoteStreams };
          delete updatedStreams[peerId];
          return updatedStreams;
        });
      }
      if (peerConnections.current[peerId]) {
        peerConnections.current[peerId].close();
        delete peerConnections.current[peerId];
      }
    });

    socketRef.current.on('new-user-connected', handleUserConnected);

    // 웹캠 및 마이크 스트림 얻기
    getMedia();

    return () => {
      // 컴포넌트 언마운트 시 정리
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      Object.values(peerConnections.current).forEach((pc) => pc.close());
      socketRef.current.disconnect();
    };
  }, [roomCode, userName, role]);

  useEffect(() => {
    // 메시지 목록 스크롤 자동 이동
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    // 번역된 수어 영상 큐가 있을 경우 재생
    if (videoQueue.length > 0) {
      playVideoQueue();
    }
  }, [videoQueue]);

  // --- 웹캠 및 마이크 스트림 ---
  const getMedia = async () => {
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setStream(currentStream);
      if (videoRef.current) {
        videoRef.current.srcObject = currentStream;
      }

      // 녹화 객체 초기화
      mediaRecorderRef.current = new MediaRecorder(currentStream);
      mediaRecorderRef.current.ondataavailable = handleDataAvailable;
      mediaRecorderRef.current.onstop = handleStop;

      // 이미 연결된 사용자들에게 트랙 추가
      Object.keys(peerConnections.current).forEach((peerId) => {
        const peerConnection = peerConnections.current[peerId];
        currentStream.getTracks().forEach((track) => {
          const sender = peerConnection
            .getSenders()
            .find((s) => s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track);
          } else {
            peerConnection.addTrack(track, currentStream);
          }
        });
      });
    } catch (error) {
      console.error('미디어 장치 접근 오류:', error);
      alert(
        '카메라나 마이크에 접근할 수 없습니다. 장치 연결 상태나 권한 설정을 확인해 주세요.'
      );
    }
  };

  // --- PeerConnection 생성 ---
  const createPeerConnection = (peerId) => {
    const peerConnection = new RTCPeerConnection(ICE_SERVERS);
    peerConnections.current[peerId] = peerConnection;

    // ICE 후보 수신
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          roomCode,
          peerId,
        });
      }
    };

    // 원격 스트림 수신
    peerConnection.ontrack = (event) => {
      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: event.streams[0],
      }));
    };

    // 연결 상태 변화
    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'disconnected') {
        setRemoteStreams((prev) => {
          const updatedStreams = { ...prev };
          delete updatedStreams[peerId];
          return updatedStreams;
        });
      }
    };

    // 협상 필요 시 (최초 Offer 등)
    peerConnection.onnegotiationneeded = async () => {
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socketRef.current.emit('offer', { roomCode, offer, peerId });
      } catch (error) {
        console.error('협상 중 오류 발생:', error);
      }
    };

    // 로컬 스트림 트랙 추가
    if (stream) {
      stream.getTracks().forEach((track) => {
        const alreadyAdded = peerConnection
          .getSenders()
          .some((sender) => sender.track === track);
        if (!alreadyAdded) {
          peerConnection.addTrack(track, stream);
        }
      });
    }

    return peerConnection;
  };

  // 모든 사용자에게 Offer 생성
  const createOfferForAllUsers = () => {
    users.forEach((user) => {
      if (user.id !== socketRef.current.id) {
        const peerConnection = createPeerConnection(user.id);
        if (stream) {
          stream.getTracks().forEach((track) => {
            const sender = peerConnection
              .getSenders()
              .find((s) => s.track.kind === track.kind);
            if (sender) {
              sender.replaceTrack(track);
            } else {
              peerConnection.addTrack(track, stream);
            }
          });
        }
        peerConnection
          .createOffer()
          .then((offer) => {
            peerConnection.setLocalDescription(offer);
            socketRef.current.emit('offer', { roomCode, offer, peerId: user.id });
          })
          .catch((error) => {
            console.error('Offer 생성 중 오류:', error);
          });
      }
    });
  };

  // 새 유저가 연결되었을 때 처리
  const handleUserConnected = (user) => {
    if (user.id !== socketRef.current.id) {
      const peerConnection = createPeerConnection(user.id);
      peerConnections.current[user.id] = peerConnection;
      createOffer(user.id);
    }
  };

  // 특정 사용자에게 Offer 생성
  const createOffer = async (peerId) => {
    const peerConnection = createPeerConnection(peerId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socketRef.current.emit('offer', { roomCode, offer, peerId });
  };

  // Offer 처리
  const handleOffer = async ({ offer, peerId }) => {
    let peerConnection = peerConnections.current[peerId];
    if (!peerConnection) {
      peerConnection = createPeerConnection(peerId);
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socketRef.current.emit('answer', { roomCode, answer, peerId });
  };

  // Answer 처리
  const handleAnswer = async ({ answer, peerId }) => {
    const peerConnection = peerConnections.current[peerId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  // ICE 후보 처리
  const handleIceCandidate = ({ candidate, peerId }) => {
    const peerConnection = peerConnections.current[peerId];
    if (peerConnection) {
      const iceCandidate = new RTCIceCandidate(candidate);
      peerConnection.addIceCandidate(iceCandidate).catch((error) => {
        console.error(`ICE 후보 추가 중 오류 (peerId: ${peerId}):`, error);
      });
    }
  };

  // --- 로컬 영상 녹화 ---
  const handleDataAvailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.current.push(event.data);
    }
  };

  const handleStop = () => {
    const blob = new Blob(recordedChunks.current, { type: 'video/webm' });
    setRecordedVideo(URL.createObjectURL(blob));
    recordedChunks.current = [];
    uploadRecording(blob);
  };

  const startRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.start();
    setRecording(true);
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    setRecording(false);
  };

  // 로컬 영상 업로드
  const uploadRecording = async (blob) => {
    const formData = new FormData();
    formData.append('video', blob, 'recording.webm');
    formData.append(
      'additionalData',
      JSON.stringify({
        recordedAt: new Date().toISOString(),
      })
    );

    try {
      const response = await fetch(`${API_URL}/api/upload-video`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('녹화 영상 업로드 성공:', data);
        alert('녹화한 영상을 업로드했습니다!');
      } else {
        console.error('녹화 영상 업로드 실패');
        alert('녹화 영상을 업로드하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch (error) {
      console.error('녹화 영상 업로드 중 오류:', error);
      alert('녹화 영상을 업로드하는 중 오류가 발생했습니다.');
    }
  };

  // --- 원격 영상 녹화 ---
  const startRemoteRecording = () => {
    const remoteStream = Object.values(remoteStreams)[0];
    if (!remoteStream) {
      alert('녹화할 원격 영상이 없습니다.');
      return;
    }

    remoteMediaRecorderRef.current = new MediaRecorder(remoteStream);
    remoteMediaRecorderRef.current.ondataavailable = handleRemoteDataAvailable;
    remoteMediaRecorderRef.current.onstop = handleRemoteStop;
    remoteMediaRecorderRef.current.start();
    setRemoteRecording(true);
  };

  const stopRemoteRecording = () => {
    if (
      remoteMediaRecorderRef.current &&
      remoteMediaRecorderRef.current.state !== 'inactive'
    ) {
      remoteMediaRecorderRef.current.stop();
    }
    setRemoteRecording(false);
  };

  const handleRemoteDataAvailable = (event) => {
    if (event.data.size > 0) {
      remoteRecordedChunks.current.push(event.data);
    }
  };

  const handleRemoteStop = () => {
    const blob = new Blob(remoteRecordedChunks.current, { type: 'video/webm' });
    setRemoteRecordedVideo(URL.createObjectURL(blob));
    remoteRecordedChunks.current = [];
    uploadRemoteRecording(blob);
  };

  // 원격 영상 업로드
  const uploadRemoteRecording = async (blob) => {
    const formData = new FormData();
    formData.append('video', blob, 'remote_recording.webm');
    formData.append(
      'additionalData',
      JSON.stringify({
        recordedAt: new Date().toISOString(),
      })
    );

    try {
      const response = await fetch(`${API_URL}/api/upload-video`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        console.log('원격 영상 업로드 성공:', data);
        alert('원격 영상을 업로드했습니다!');
      } else {
        console.error('원격 영상 업로드 실패');
        alert('원격 영상을 업로드하지 못했습니다. 다시 시도해 주세요.');
      }
    } catch (error) {
      console.error('원격 영상 업로드 중 오류:', error);
      alert('원격 영상을 업로드하는 중 오류가 발생했습니다.');
    }
  };

  // --- 채팅 메시지 ---
  const sendMessage = () => {
    if (message.trim()) {
      socketRef.current.emit('send message', {
        roomCode,
        userName,
        role,
        text: message,
      });
      setMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // 텍스트 -> 수어 번역
  const translateMessage = (msg) => {
    socketRef.current.emit('translate', { text: msg.text, roomCode });
  };

  // 번역된 텍스트 -> 합쳐진 수어 영상 재생
  const handleTranslatedMessage = async (translatedMessage) => {
    const words = translatedMessage.split(' ');
    const folder = words.join('_');

    try {
      const response = await fetch(
        `${API_URL}/api/get-concatenated-video?folder=${encodeURIComponent(folder)}`
      );
      const data = await response.json();
      if (data && data.videoPath) {
        // /videos/... 형태의 경로
        const videoPath = `${API_URL}${data.videoPath}`;
        setVideoQueue([videoPath]);
        setTranslatedVideos((prev) => [...prev, videoPath]);
      } else {
        console.error(`${words}에 대한 영상 파일을 찾지 못했습니다.`);
      }
    } catch (error) {
      console.error('번역된 영상 경로를 불러오는 중 오류:', error);
    }
  };

  // 큐에 쌓인 수어 영상 재생
  const playVideoQueue = () => {
    if (videoQueue.length === 0) return;

    const currentVideo = videoQueue[0];
    setVideoQueue((prev) => prev.slice(1));

    if (!videoElementRef.current) {
      videoElementRef.current = document.createElement('video');
      videoElementRef.current.autoplay = true;
      videoElementRef.current.className = 'video-element translated';
      videoElementRef.current.controls = true;

      if (videoContainerRef.current) {
        videoContainerRef.current.innerHTML = '';
        videoContainerRef.current.appendChild(videoElementRef.current);
      }
    }

    videoElementRef.current.src = currentVideo;
    videoElementRef.current.load();

    videoElementRef.current.addEventListener('loadedmetadata', () => {
      console.log('영상 메타데이터 로드 완료');
      console.log(`영상 길이: ${videoElementRef.current.duration}`);
    });

    videoElementRef.current.addEventListener('error', (e) => {
      console.error('영상 로딩 오류:', e);
      playVideoQueue();
    });
  };

  // 녹화된 수어 영상(파일) -> 모델 추론(번역)
  const translateVideo = async () => {
    if (recordedVideo) {
      try {
        const response = await fetch(`${API_URL}/api/translate-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: recordedVideo, roomCode }),
        });
        const data = await response.json();
        if (data.error) {
          console.error('영상 번역 오류:', data.error);
          setMessages((prev) => [
            ...prev,
            {
              userName: 'System',
              text: `번역 오류: ${data.error}`,
              role: 'error',
            },
          ]);
        }
      } catch (error) {
        console.error('영상 번역 중 오류:', error);
        setMessages((prev) => [
          ...prev,
          {
            userName: 'System',
            text: `영상 번역 중 오류가 발생했습니다: ${error.message}`,
            role: 'error',
          },
        ]);
      }
    }
  };

  // 원격 녹화된 수어 영상(파일) -> 모델 추론(번역)
  const translateRemoteVideo = async () => {
    if (remoteRecordedVideo) {
      try {
        const response = await fetch(`${API_URL}/api/translate-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl: remoteRecordedVideo, roomCode }),
        });
        const data = await response.json();
        if (data.error) {
          console.error('원격 영상 번역 오류:', data.error);
          setMessages((prev) => [
            ...prev,
            {
              userName: 'System',
              text: `번역 오류: ${data.error}`,
              role: 'error',
            },
          ]);
        }
      } catch (error) {
        console.error('원격 영상 번역 중 오류:', error);
        setMessages((prev) => [
          ...prev,
          {
            userName: 'System',
            text: `원격 영상 번역 중 오류가 발생했습니다: ${error.message}`,
            role: 'error',
          },
        ]);
      }
    }
  };

  return (
    <div className="translation-room">
      <h2>양방향 번역 방: {roomName || roomCode}</h2>

      <div className="user-list">
        <h3>사용자 정보:</h3>
        <ul>
          {users.map((user) => (
            <li key={user.id} className={`user ${user.role}`}>
              {user.role}: {user.name}
            </li>
          ))}
        </ul>
      </div>

      <div className="video-container">
        {/* 내 웹캠 영상 */}
        <video ref={videoRef} autoPlay muted playsInline className="video-element" />

        {/* 원격 사용자들의 웹캠 영상 */}
        {Object.keys(remoteStreams).map((peerId) => (
          <video
            id={`video-${peerId}`}
            key={peerId}
            ref={(el) => {
              if (el) {
                el.srcObject = remoteStreams[peerId];
              }
            }}
            autoPlay
            playsInline
            className="video-element"
          />
        ))}

        <div className="controls">
          <button onClick={createOfferForAllUsers} className="start-video-button">
            화상통화 시작
          </button>

          <button
            onClick={recording ? stopRecording : startRecording}
            className={`record-button ${recording ? 'recording' : ''}`}
          >
            {recording ? '내 영상 녹화 중지' : '내 영상 녹화 시작'}
          </button>

          <button
            onClick={remoteRecording ? stopRemoteRecording : startRemoteRecording}
            className={`record-button ${remoteRecording ? 'remote-recording' : ''}`}
          >
            {remoteRecording ? '원격 영상 녹화 중지' : '원격 영상 녹화 시작'}
          </button>
        </div>
      </div>

      {recordedVideo && (
        <div className="recorded-video-container">
          <h3>녹화 영상:</h3>
          <video src={recordedVideo} controls />
          <button className="translate-button" onClick={translateVideo}>
            수어영상 번역
          </button>
        </div>
      )}

      {remoteRecordedVideo && (
        <div className="recorded-video-container">
          <h3>원격 녹화 영상:</h3>
          <video src={remoteRecordedVideo} controls />
          <button className="translate-button" onClick={translateRemoteVideo}>
            원격 수어 녹화영상 번역
          </button>
        </div>
      )}

      <div id="videoContainer" ref={videoContainerRef} className="video-container">
        {/* 수어 영상이 재생될 video element가 동적으로 추가됩니다 */}
      </div>

      <div className="messages">
        {messages.map((msg, index) => (
          <p key={index} className={`message ${msg.role}`}>
            <strong>{msg.userName}:</strong> {msg.text}
            {msg.videoPath && (
              <button onClick={() => window.open(msg.videoPath, '_blank')}>
                영상 재생
              </button>
            )}
            {msg.role !== 'sign-translation' && !msg.translatedText && (
              <button onClick={() => translateMessage(msg)}>번역</button>
            )}
            {/* {msg.translatedText && <span> (번역: {msg.translatedText})</span>} */}
          </p>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-container">
        <textarea
          id="message"
          name="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="메시지를 입력하세요. Enter 키로 전송, Shift+Enter로 줄바꿈"
        />
        <button onClick={sendMessage}>전송</button>
      </div>

      <div id="translated-video-container"></div>
    </div>
  );
}

export default TranslationRoom;
