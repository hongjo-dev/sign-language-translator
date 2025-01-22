import os
import ffmpeg
from dotenv import load_dotenv

load_dotenv()

folder_path = os.environ.get('VIDEO_CONVERT_PATH')
if not folder_path:
    print("ERROR: VIDEO_CONVERT_PATH is not set in .env")
    exit(1)

files = os.listdir(folder_path)
webm_files = [f for f in files if f.endswith('.webm')]

for webm_file in webm_files:
    webm_path = os.path.join(folder_path, webm_file)
    mp4_file = webm_file[:-5] + '.mp4'
    mp4_path = os.path.join(folder_path, mp4_file)

    try:
        (
            ffmpeg
            .input(webm_path)
            .output(mp4_path)
            .run()
        )
        print(f'{webm_file} 변환 완료 -> {mp4_file}')
    except ffmpeg.Error as e:
        print(f'{webm_file} 변환 중 오류 발생:', e.stderr)
