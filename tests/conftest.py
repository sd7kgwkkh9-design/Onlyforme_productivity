import os
import sys

import pytest

# 테스트 파일에서 프로젝트 루트의 app.py, db.py를 import할 수 있게 경로 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app  # noqa: E402


@pytest.fixture
def client(tmp_path):
    """테스트마다 새 임시 DB로 앱을 만든다 (실제 데이터는 건드리지 않음)."""
    app = create_app(str(tmp_path / "test.db"))
    app.config["TESTING"] = True
    return app.test_client()
