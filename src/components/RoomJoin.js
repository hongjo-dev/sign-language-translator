import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './RoomJoin.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch } from '@fortawesome/free-solid-svg-icons';

function RoomJoin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userName } = location.state || {}; // 이전 화면에서 넘어온 사용자 이름

  const [roomName, setRoomName] = useState('');
  const [role, setRole] = useState('');
  const [availableRooms, setAvailableRooms] = useState([]); // 검색된 방 목록
  const [selectedRoom, setSelectedRoom] = useState(null);  // 선택한 방
  const [roomCode, setRoomCode] = useState('');            // 참여할 방 코드
  const [isModalOpen, setIsModalOpen] = useState(false);   // 새 방 생성 모달 열림 상태
  const [newRoomName, setNewRoomName] = useState('');      // 새 방 이름
  const [newRoomCode, setNewRoomCode] = useState('');      // 새 방 코드
  const [newRoomRole, setNewRoomRole] = useState('');      // 새 방에서의 역할

  // 컴포넌트 로드 시 방 목록을 서버에서 가져옴
  useEffect(() => {
    fetch('/api/rooms')
      .then(response => response.json())
      .then(data => setAvailableRooms(data))
      .catch(error => console.error('방 목록을 가져오는 중 오류 발생:', error));
  }, []);

  // 기존 방 참여하기
  const handleJoinRoom = () => {
    if (!selectedRoom || roomCode !== selectedRoom.code || !role || !userName) {
      alert('유효한 방 코드, 역할, 사용자 이름을 선택하세요.');
      return;
    }
    // 방에 참여
    navigate(`/room/${roomCode}`, {
      state: {
        role,
        roomName: selectedRoom.name,
        userName,
      },
    });
  };

  // 새로운 방 생성하기
  const handleCreateRoom = () => {
    if (newRoomName && newRoomCode && newRoomRole) {
      const newRoom = {
        name: newRoomName,
        code: newRoomCode,
        role: newRoomRole,
      };
      fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newRoom),
      })
        .then(response => {
          if (response.ok) {
            return response.json(); // 성공 시 JSON 변환
          } else {
            throw new Error('방 생성 실패');
          }
        })
        .then(data => {
          // 새 방이 목록에 추가되도록 갱신
          setAvailableRooms(prevRooms => [...prevRooms, newRoom]);
          console.log('방 생성:', newRoomName, '코드:', newRoomCode);
          setIsModalOpen(false);
          navigate(`/room/${newRoomCode}`, {
            state: { role: newRoomRole, roomName: newRoomName, userName },
          });
        })
        .catch(error => console.error('방 생성 중 오류 발생:', error));
    } else {
      alert('방 이름, 방 코드, 역할을 모두 입력하세요.');
    }
  };

  // 방 검색
  const handleSearchRooms = () => {
    // roomName이 포함된 방들만 필터링
    setAvailableRooms(prevRooms =>
      prevRooms.filter(room => room.name.includes(roomName))
    );
  };

  // 특정 방 클릭 시 상태 업데이트
  const handleRoomSelection = (room) => {
    setSelectedRoom(room);
    setRoomCode('');
  };

  // Enter 키로 검색
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearchRooms();
    }
  };

  // 모달에서 Enter 키로 방 생성
  const handleModalKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCreateRoom();
    }
  };

  // 새 방 생성 모달 열기/닫기
  const openModal = () => {
    setIsModalOpen(true);
  };
  const closeModal = () => {
    setIsModalOpen(false);
    setNewRoomName('');
    setNewRoomCode('');
    setNewRoomRole('');
  };

  return (
    <div className="room-join-container">
      <h2>방 참여 또는 생성</h2>
      <div className="search-bar">
        <input
          type="text"
          className="search-input"
          placeholder="방 이름을 입력하거나 검색하세요"
          value={roomName}
          onChange={e => setRoomName(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <button onClick={handleSearchRooms} className="search-button">
          <FontAwesomeIcon icon={faSearch} />
        </button>
      </div>
      <div className="search-results">
        {availableRooms.map(room => (
          <div
            key={room.code}
            className="search-result-item"
            onClick={() => handleRoomSelection(room)}
          >
            <div className="search-result-icon">{room.icon}</div>
            <div className="search-result-text">
              <div className="search-result-name">{room.name}</div>
            </div>
          </div>
        ))}
      </div>
      {selectedRoom && (
        <div className="room-code-input">
          <h3>선택하신 방: {selectedRoom.name}</h3>
          <p>아래에 방 코드를 입력하세요.</p>
          <input
            type="text"
            className="code-input"
            placeholder="방 코드를 입력하세요"
            value={roomCode}
            onChange={e => setRoomCode(e.target.value)}
          />
        </div>
      )}
      <div className="role-selection">
        <label>
          <input
            type="radio"
            name="role"
            value="signUser"
            checked={role === 'signUser'}
            onChange={e => setRole(e.target.value)}
          />
          수어 사용자
        </label>
        <label>
          <input
            type="radio"
            name="role"
            value="koreanUser"
            checked={role === 'koreanUser'}
            onChange={e => setRole(e.target.value)}
          />
          한국어 사용자
        </label>
      </div>
      <button onClick={handleJoinRoom} className="join-button">
        참여하기
      </button>
      <button onClick={openModal} className="create-button">
        방 만들기
      </button>

      {/* 새 방 생성 모달 */}
      {isModalOpen && (
        <div className="modal">
          <div className="modal-content">
            <span className="close-button" onClick={closeModal}>
              &times;
            </span>
            <h2>
                새로운 방 이름과 코드를
                <br />
                입력하세요
            </h2>
            <input
              type="text"
              className="modal-input"
              placeholder="방 이름을 입력하세요"
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              onKeyPress={handleModalKeyPress}
            />
            <input
              type="text"
              className="modal-input"
              placeholder="방 코드를 입력하세요"
              value={newRoomCode}
              onChange={e => setNewRoomCode(e.target.value)}
              onKeyPress={handleModalKeyPress}
            />
            <div className="role-selection">
              <label>
                <input
                  type="radio"
                  name="newRoomRole"
                  value="signUser"
                  checked={newRoomRole === 'signUser'}
                  onChange={e => setNewRoomRole(e.target.value)}
                />
                수어 사용자
              </label>
              <label>
                <input
                  type="radio"
                  name="newRoomRole"
                  value="koreanUser"
                  checked={newRoomRole === 'koreanUser'}
                  onChange={e => setNewRoomRole(e.target.value)}
                />
                한국어 사용자
              </label>
            </div>
            <button onClick={handleCreateRoom} className="create-button">
              방 만들기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RoomJoin;
