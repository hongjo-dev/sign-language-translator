import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Home from './components/Home';
import RoomJoin from './components/RoomJoin';
import TranslationRoom from './components/TranslationRoom';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/join" element={<RoomJoin />} />
                <Route path="/room/:roomCode" element={<TranslationRoom />} />
            </Routes>
        </Router>
    );
}

export default App;
