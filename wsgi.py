"""
인터넷 서버(PythonAnywhere 등)용 진입점.

서버는 이 파일의 `application`을 불러서 실행한다.
production=True라서 비밀번호가 설정되어 있지 않으면 캘린더가 열리지 않는다.
(비밀번호 정하기: 서버의 Bash 콘솔에서  python app.py --set-password)
"""

from app import create_app

application = create_app(production=True)
