import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

function Home() {
    const navigate = useNavigate();
    const [userName, setUserName] = useState('');

    const handleStart = () => {
        if (userName.trim()) {
            navigate('/join', { state: { userName } });
        } else {
            alert('사용자 이름을 입력하세요.');
        }
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleStart();
        }
    };

    return (
        <div className="home-container">
            <header>
                <h1>양방향 수화 번역 시스템</h1>
            </header>
            <main>
                <form 
                    id="login_form" 
                    className="form_class" 
                    onSubmit={(e) => { 
                        e.preventDefault(); 
                        handleStart(); 
                    }}
                >
                    <div className="form_div">
                        <label>사용자이름:</label>
                        <input
                            className="field_class"
                            name="username"
                            type="text"
                            placeholder="사용자 이름을 입력하세요."
                            value={userName}
                            onChange={(e) => setUserName(e.target.value)}
                            onKeyPress={handleKeyPress}
                            autoFocus
                        />
                        <button className="submit_class" type="submit">
                            시작
                        </button>
                    </div>
                </form>
            </main>
            <footer>
                <p>
                    Developed by <a href="#">An hong jo&trade;</a>
                </p>
            </footer>
        </div>
    );
}

export default Home;
