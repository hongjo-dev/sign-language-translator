const fs = require('fs');
const https = require('https');
const express = require('express');
const path = require('path');
require('dotenv').config();
const bodyParser = require('body-parser');
const socketIo = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const multer = require('multer');
const { exec } = require('child_process');
const app = express();
const server = https.createServer({
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
  }, app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ['GET', 'POST'],
    }
});

const PORT = process.env.PORT || 5000;
const VIDEO_BASE_PATH = process.env.VIDEO_BASE_PATH;
const VIDEO_SAVE_PATH = process.env.VIDEO_SAVE_PATH;
const FFMPEG_PATH = process.env.FFMPEG_PATH;
// 방 목록을 저장할 객체 초기화
let rooms = {};
let translatedVideos = []; // 번역된 동영상 경로를 저장하는 배열

// CORS 설정
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'build')));

// Multer 설정 (파일 업로드를 위한 미들웨어)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const folderName = path.parse(file.originalname).name;
        const folderPath = path.join(VIDEO_SAVE_PATH, folderName);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        cb(null, folderPath);
    },
    // filename: (req, file, cb) => {
    //     cb(null, file.originalname);
    // }
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const originalName = file.originalname;
        const extension = path.extname(originalName);
        cb(null, `${timestamp}${extension}`);  // 타임스탬프를 파일 이름으로 사용
    }
});
const upload = multer({ storage: storage });

// 비디오 파일 업로드 엔드포인트
app.post('/api/upload-video', upload.single('video'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).send({ message: 'No file uploaded' });
    }

    // 파일 권한 확인
    fs.access(file.path, fs.constants.W_OK, (err) => {
        if (err) {
            console.error('No write access to file:', err);
            return res.status(500).send({ message: 'No write access to file' });
        }
        console.log('File uploaded and accessible for writing:', file.path);
        res.send({ message: 'File uploaded successfully', path: file.path });
    });
});
// 비디오 파일 제공을 위한 정적 경로 설정
app.use('/videos', express.static(VIDEO_BASE_PATH, {
    setHeaders: (res, path) => {
        console.log(`Serving file: ${path}`);
        const fileExtension = path.split('.').pop();
        if (fileExtension === 'mp4') {
            res.setHeader('Content-Type', 'video/mp4');
        }
    }
}));

// 경로를 정리하는 함수
const sanitizePath = (inputPath) => {
    return inputPath.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_');
};

// 비디오 파일 복사 함수
const copyVideoFiles = (words, sourceFolder, targetFolder, callback) => {
    let copiedFiles = [];

    words.forEach(word => {
        let sanitizedWord = word;
        if (word.includes('?')) {
            sanitizedWord = sanitizePath(word);
        }
        const wordFolderPath = path.join(sourceFolder, sanitizedWord);

        if (!fs.existsSync(wordFolderPath)) {
            console.log(`Folder not found: ${wordFolderPath}`);
            return;
        }

        // 폴더 내 파일 목록을 확인하여 패턴에 맞는 파일을 찾음
        const files = fs.readdirSync(wordFolderPath);
        const videoFile = files.find(file => file.includes(`converted_`) && file.includes(sanitizedWord));

        if (videoFile) {
            const videoFilePath = path.join(wordFolderPath, videoFile);
            const targetPath = path.join(targetFolder, path.basename(videoFilePath));
            fs.copyFileSync(videoFilePath, targetPath);
            copiedFiles.push(targetPath);
        } else {
            console.log(`File not found for word: ${word}`);
        }
    });

    if (copiedFiles.length > 0) {
        callback(null);
    } else {
        callback(new Error('No video files found to copy'));
    }
};


// 폴더 내 동영상 파일 합치기
const concatVideos = (folderPath, outputFilePath, callback) => {
    fs.readdir(folderPath, (err, files) => {
        if (err) {
            console.error(`Error reading folder: ${err}`);
            return callback(err);
        }

        // 동영상 파일 필터링 및 존재 여부 확인
        const videoFiles = files
            .filter(file => file.startsWith('converted_') && file.endsWith('.mp4'))
            .map(file => path.join(folderPath, file))
            .filter(filePath => fs.existsSync(filePath));

        if (videoFiles.length === 0) {
            return callback(new Error('No video files found in folder'));
        }

        const concatFilePath = path.join(folderPath, 'filelist.txt');
        const fileList = videoFiles.map(file => `file '${file}'`).join('\n');
        fs.writeFileSync(concatFilePath, fileList);

        const ffmpegProcess = spawn(FFMPEG_PATH, ['-f', 'concat', '-safe', '0', '-i', concatFilePath, '-c', 'copy', '-y', outputFilePath]);

        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        ffmpegProcess.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        ffmpegProcess.on('close', (code) => {
            setTimeout(() => { // 딜레이 추가
                tryDeleteFile(concatFilePath, 5); // 파일 삭제 시도, 최대 5번 재시도
            }, 1000);

            if (code === 0) {
                console.log('FFmpeg process succeeded');
                callback(null);
            } else {
                console.error('FFmpeg process failed');
                callback(new Error('FFmpeg process failed'));
            }
        });
    });
};
function tryDeleteFile(filePath, attempts) {
    if (attempts <= 0) {
        console.error('Failed to delete file after several attempts:', filePath);
        return;
    }
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('Temporary file deleted successfully:', filePath);
        }
    } catch (error) {
        console.error('Error deleting file, retrying...', error);
        setTimeout(() => tryDeleteFile(filePath, attempts - 1), 1000); // 재시도 로직
    }
}
// 합쳐진 비디오 파일 제공 엔드포인트
app.get('/api/get-concatenated-video', (req, res) => {
    const words = req.query.folder.split('_').map(word => word);
    const folderPath = path.join(VIDEO_BASE_PATH, sanitizePath(req.query.folder));
    const outputFilePath = path.join(folderPath, 'concatenated_output.mp4');

    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }

    copyVideoFiles(words, VIDEO_BASE_PATH, folderPath, (err) => {
        if (err) {
            console.error(`Error copying video files: ${err}`);
            return res.status(500).json({ error: 'Error copying video files' });
        }

        concatVideos(folderPath, outputFilePath, (err) => {
            if (err) {
                console.error(`Error concatenating videos: ${err}`);
                return res.status(500).json({ error: 'Error concatenating videos' });
            }
            translatedVideos.push(`/videos/${encodeURIComponent(sanitizePath(req.query.folder))}/concatenated_output.mp4`); // 번역된 동영상 경로 저장
            res.json({ videoPath: `/videos/${encodeURIComponent(sanitizePath(req.query.folder))}/concatenated_output.mp4` });
        });
    });
});

// 번역된 동영상 리스트 제공 엔드포인트

// app.get('/api/translated-videos', (req, res) => {
//     res.json(translatedVideos);
// });

// 방 목록 가져오기
app.get('/api/rooms', (req, res) => {
    const roomList = Object.keys(rooms).map(roomCode => ({
        code: roomCode,
        name: rooms[roomCode].name,
        icon: 'F',
        userCount: rooms[roomCode].users.length
    }));
    res.json(roomList);
});

// 방 생성
app.post('/api/rooms', (req, res) => {
    const { name, code } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: 'Room name and code are required' });
    }
    if (!rooms[code]) {
        rooms[code] = { name, users: [], offers: {} };
        res.status(201).json({ message: 'Room created', code, name });
    } else {
        res.status(409).json({ message: 'Room already exists' });
    }
});

// 번역 함수 정의
const translateMessage = (text, callback) => {
    fs.readFile(path.join(__dirname, 'model/src_vocab.json'), 'utf8', (err, src_vocab_data) => {
        if (err) return callback(err, null);
        fs.readFile(path.join(__dirname, 'model/trg_vocab.json'), 'utf8', (err, trg_vocab_data) => {
            if (err) return callback(err, null);

            const src_vocab = JSON.parse(src_vocab_data);
            const trg_vocab = JSON.parse(trg_vocab_data);

            const pythonProcess = spawn('python', ['model/translate_model.py']);

            pythonProcess.stdin.write(JSON.stringify({ sentence: text, src_vocab, trg_vocab }));
            pythonProcess.stdin.end();

            let dataString = '';
            let errorString = '';

            pythonProcess.stdout.on('data', (data) => {
                dataString += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                errorString += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(dataString);
                        if (result.error) {
                            callback(result.error, null);
                        } else {
                            callback(null, result.translation);
                        }
                    } catch (error) {
                        callback(error, null);
                    }
                } else {
                    callback(errorString, null);
                }
            });
        });
    });
};




app.post('/api/translate', (req, res) => {
    const { text } = req.body;

    translateMessage(text, (err, translation) => {
        if (err) {
            res.status(500).json({ message: 'Translation service failed', error: err });
        } else {
            res.json({ translation });
        }
    });
});

app.post('/api/translate-video', async (req, res) => {
    const { videoUrl, roomCode } = req.body;
    
    exec('python C:/졸작_범_test/recog_model.py', (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: 'Error executing recog_model.py' });
        }
        console.log('recog_model.py executed successfully.');
        
        const pythonProcess = spawn('python', ['C:/졸작_범_test/sign-language-translator/model/translate2.py'], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        
        let dataString = '';
        let errorString = '';
        
        pythonProcess.stdout.on('data', (data) => {
            dataString += data.toString('utf-8');
            console.log(dataString)
        });
        
        pythonProcess.stderr.on('data', (data) => {
            errorString += data.toString('utf-8');
            console.error(`translate2.py stderr: ${data}`);
        });
        
        pythonProcess.on('close', (code) => {
            if (code === 0 && dataString.trim()) {
                try {
                    const result = JSON.parse(dataString);
                    io.to(roomCode).emit('translated sign message', {
                        userName: '번역',
                        text: result.translation,
                        originalText: result.translation
                    });
                    res.json(result);
                } catch (error) {
                    console.error(`JSON parse error: ${error}`);
                    res.status(500).json({ error: 'Error parsing translate2.py output', details: dataString });
                }
            } else {
                console.error(`translate2.py exited with code ${code}`);
                console.error(`Error output: ${errorString}`);
                res.status(500).json({ error: 'Error executing translate2.py', details: errorString || dataString });
            }
        });
    });
});


// const translateVideo = async () => {
//     return `${trans_text}`;
// };

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

io.on('connection', (socket) => {
    socket.on('join room', ({ roomCode, userName, role }) => {
        if (rooms[roomCode]) {
            socket.join(roomCode);
            rooms[roomCode].users.push({ id: socket.id, name: userName, role });
            io.to(roomCode).emit('update user list', rooms[roomCode].users);
            socket.to(roomCode).emit('message', { userName, text: `${userName} has joined the room.` });

            rooms[roomCode].users.forEach(user => {
                if (user.id !== socket.id && rooms[roomCode].offers[user.id]) {
                    socket.emit('offer', { offer: rooms[roomCode].offers[user.id], peerId: user.id });
                }
            });
        } else {
            socket.emit('error', 'Room does not exist');
        }
    });

    socket.on('disconnect', () => {
        Object.keys(rooms).forEach(roomCode => {
            const userIndex = rooms[roomCode].users.findIndex(user => user.id === socket.id);
            if (userIndex !== -1) {
                const userName = rooms[roomCode].users[userIndex].name;
                rooms[roomCode].users.splice(userIndex, 1);
                io.to(roomCode).emit('update user list', rooms[roomCode].users);
                socket.to(roomCode).emit('message', { text: `${userName} has left the room.` });
                socket.to(roomCode).emit('user-disconnected', socket.id);
            }
            if (rooms[roomCode].users.length === 0) {
                delete rooms[roomCode];
            }
        });
    });

    socket.on('send message', (data) => {
        io.to(data.roomCode).emit('message', { userName: data.userName, text: data.text });
    });
    
    socket.on('translate', ({ text, roomCode }) => {
        translateMessage(text, async (err, translation) => {
            if (err) {
                console.error('Translation error:', err);
            } else {
                const words = translation.split(' ');
                const folder = words.join('_');
                const videoPath = await getVideoPath(folder);
    
                io.to(roomCode).emit('translated message', {
                    userName: '번역',
                    text: translation,
                    originalText: text,
                    videoPath: videoPath
                });
            }
        });
    });

    const getVideoPath = async (folder) => {
        return new Promise((resolve, reject) => {
            const requestUrl = new URL(`/api/get-concatenated-video?folder=${encodeURIComponent(folder)}`, 'https://115.136.216.147:5000');
            const options = {
                hostname: requestUrl.hostname,
                port: requestUrl.port,
                path: requestUrl.pathname + requestUrl.search,
                method: 'GET',
                rejectUnauthorized: false // 자체 서명된 인증서를 신뢰하도록 설정
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        if (jsonData.videoPath) {
                            resolve(jsonData.videoPath);
                        } else {
                            resolve(null);
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.end();
        });
    };
    
    socket.on('offer', (data) => {
        const { offer, peerId } = data;
        rooms[data.roomCode].offers[socket.id] = offer;
        io.to(peerId).emit('offer', { offer, peerId: socket.id });
    });

    socket.on('answer', (data) => {
        const { answer, peerId } = data;
        io.to(peerId).emit('answer', { answer, peerId: socket.id });
    });

    socket.on('ice-candidate', (data) => {
        const { candidate, peerId } = data;
        io.to(peerId).emit('ice-candidate', { candidate, peerId: socket.id });
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
