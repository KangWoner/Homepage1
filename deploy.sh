#!/bin/bash
# Growth Index 배포 스크립트

echo "🚀 Growth Index 배포 시작..."

# 1. Firebase CLI 확인
if ! command -v firebase &> /dev/null
then
    echo "❌ Firebase CLI가 설치되지 않았습니다."
    echo "설치 명령: npm install -g firebase-tools"
    exit 1
fi

# 2. Functions 종속성 설치
echo "📦 Functions 종속성 설치 중..."
cd functions
npm install
cd ..

# 3. Firebase 프로젝트 선택
echo "🔧 Firebase 프로젝트: questio-2dd69"
firebase use questio-2dd69

# 4. Firestore Rules 배포
echo "🔐 Firestore Rules 배포 중..."
firebase deploy --only firestore:rules

# 5. Functions 배포
echo "⚡ Functions 배포 중..."
firebase deploy --only functions

# 6. Hosting 배포
echo "🌐 Hosting 배포 중..."
firebase deploy --only hosting

echo ""
echo "✅ 배포 완료!"
echo ""
echo "테스트 URL: https://questio-2dd69.web.app"
echo "Functions URL: https://us-central1-questio-2dd69.cloudfunctions.net/submitAnswer"
echo ""
echo "📖 테스트 가이드: GROWTH_INDEX_TEST_GUIDE.md 참조"
