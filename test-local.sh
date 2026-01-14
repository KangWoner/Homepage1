#!/bin/bash
# 로컬 테스트 스크립트

echo "🧪 Growth Index 로컬 테스트 시작..."

# 1. Firebase CLI 확인
if ! command -v firebase &> /dev/null
then
    echo "❌ Firebase CLI가 설치되지 않았습니다."
    echo "설치 명령: npm install -g firebase-tools"
    exit 1
fi

# 2. Functions 종속성 설치
echo "📦 Functions 종속성 확인 중..."
if [ ! -d "functions/node_modules" ]; then
    echo "종속성 설치 중..."
    cd functions
    npm install
    cd ..
else
    echo "✓ 종속성이 이미 설치되어 있습니다."
fi

# 3. 환경 변수 설정 (필요시)
export GOOGLE_CLOUD_PROJECT=questio-2dd69

# 4. 에뮬레이터 시작
echo ""
echo "🚀 Firebase 에뮬레이터 시작 중..."
echo ""
echo "접속 URL:"
echo "  - Hosting:   http://localhost:5000"
echo "  - Functions: http://localhost:5001"
echo "  - Firestore: http://localhost:8080"
echo "  - UI:        http://localhost:4000"
echo ""
echo "⚠️  주의: 에뮬레이터는 메모리에만 데이터를 저장합니다."
echo "   재시작하면 모든 데이터가 초기화됩니다."
echo ""
echo "📖 테스트 가이드: GROWTH_INDEX_TEST_GUIDE.md"
echo ""
echo "종료하려면 Ctrl+C를 누르세요."
echo ""

firebase emulators:start
