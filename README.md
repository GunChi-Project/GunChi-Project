# 🌊 파주시 긴급 대피 경로 시스템 (SafeRoute)

> **2025 경기 기후 바이브코딩 해커톤 제출작** > 실시간 기상 데이터와 과거 침수 이력을 결합한 능동형 재난 대피 시뮬레이션

<br/>

## 🚀 배포 주소 (Live Demo)
👉 **[서비스 바로가기 (https://saferoute-delta.vercel.app/)](https://saferoute-delta.vercel.app/)**
> 별도의 설치 없이 위 링크를 클릭하면 PC/모바일 환경에서 즉시 시뮬레이션을 체험하실 수 있습니다.

---

## 1. 프로젝트 개요 (Overview)
**"지금 100mm의 폭우가 쏟아진다면, 당신은 어디로 대피하시겠습니까?"**

이 프로젝트는 파주시의 **실제 과거 침수 흔적 데이터(Shapefile)**와 **실시간 기상 API**를 결합하여, 극한 호우 발생 시 안전한 생존 경로를 안내하는 웹 서비스입니다. 
단순한 대피소 위치 안내를 넘어, 사용자가 입력한 강수량에 따라 **위험 구역이 동적으로 확장**되는 시뮬레이션을 시각화하고, 이를 회피하는 **최적의 대피 경로**를 제시합니다.

## 2. 문제 정의 (Problem Definition)
* **기후 위기의 현실화**: 매년 반복되는 집중 호우로 파주시(공릉천, 문산천 일대) 등 저지대 침수 피해가 증가하고 있습니다.
* **정보의 한계**: 기존 재난 문자는 "대피하라"는 경고에 그칠 뿐, **"침수된 도로를 피해 어디로 가야 하는지"**에 대한 구체적인 경로 정보가 부재합니다.
* **솔루션**: 사용자가 직접 강수량을 설정하여 미래 상황을 예측하고(Simulation), 침수되지 않은 **'실제 이동 가능한 안전 경로'**를 제공합니다.

## 3. 핵심 기능 (Key Features)

### 🌤️ 실시간 기상 데이터 연동
* 접속과 동시에 `Open-Meteo API`를 통해 파주시의 현재 날씨 코드와 강수량을 실시간으로 로드합니다.
* 평상시에는 실시간 모드로 모니터링 기능을 수행합니다.

### 🌊 동적 침수 시뮬레이션 (Dynamic Flood Simulation)
* **Turf.js** 기반의 공간 분석 알고리즘을 통해 강수량에 따른 위험 반경을 계산합니다.
* **알고리즘 로직**: `Buffer Distance = (입력 강수량 - 30mm) * 5.0` 공식에 따라 침수 구역을 동적으로 확장 및 병합(Union)합니다.
    * **~30mm**: ✅ 안전 (Safe)
    * **30~80mm**: ⚠️ 주의보 (Warning) - 과거 침수 이력 지역 위주 경고
    * **80mm 이상**: 🚨 극한호우 (Danger) - 주변 도로 및 저지대까지 침수 구역 대폭 확장

### 🛡️ 스마트 대피소 필터링
* **상태 기반 필터링**: 시뮬레이션 결과 침수 위험 구역 내부에 포함된 대피소는 즉시 **'폐쇄(Closed)'** 처리하고 회색으로 비활성화합니다.
* **최단 거리 추천**: 사용자 위치 기준 직선거리가 아닌, 도로망 기준 가장 가깝고 **운영 중인(Operating)** 대피소 상위 3곳을 선별합니다.

### 📍 생존 경로 탐색 (Safe Routing)
* `OSRM (Open Source Routing Machine)`을 활용하여 도보/차량 이동 경로를 탐색합니다.
* 경로상에 침수 위험 구역이 포함될 경우 이를 감지하여 **"위험 지역"** 경고를 띄우거나 우회 경로를 제안합니다.

## 4. 폴더 구조 (Directory Structure)
```
GunChi-Project/
├── .gitignore          # Git 제외 파일 설정
├── index.html          # 메인 UI 및 레이아웃
├── safeRoute.js        # 핵심 로직 (API 호출, Turf.js 공간 연산, 시뮬레이션)
├── style.css           # 스타일시트 (애니메이션, 반응형 디자인)
└── README.md           # 프로젝트 설명 문서
```

## 5. 기술 스택 (Tech Stack)
* **Frontend**: HTML5, CSS3, JavaScript (Vanilla JS)
* **Map Engine**: Leaflet.js
* **Spatial Analysis**: Turf.js (Buffer, Union, BooleanPointInPolygon), Proj4js (좌표계 변환 EPSG:5179 ↔ WGS84)
* **Data API**: 
    * Open-Meteo (Weather)
    * OSRM (Routing)
    * GeoServer WFS (Spatial Data)
* **Utility**: CORS Proxy (corsproxy.io - WFS 데이터 호출용)

## 6. 활용 데이터 (Data Sources)
이 프로젝트는 신뢰할 수 있는 공공데이터를 실시간 API로 호출하여 분석합니다.
* **침수흔적도 (`spggcee:tm_fldn_trce`)**: 경기데이터드림 - 파주시 과거 실제 침수 구역 데이터
* **이재민 임시거주시설 (`spggcee:dsvctm_tmpr_hab_fclt`)**: 경기데이터드림 - 대피소 위치 정보
* **기상 정보**: Open-Meteo Free Weather API
* **지리 정보**: OpenStreetMap, 파주시 행정경계 GeoJSON

## 7. 실행 방법 (How to Run)
**[권장] 위 배포 주소(Live Demo)를 통해 접속하는 것을 권장합니다.**

로컬 환경에서 실행하려면:
1.  이 저장소를 다운로드하거나 클론(`git clone`)합니다.
2.  **Web Server 환경**에서 `index.html`을 실행합니다.
    > ⚠️ **주의**: 브라우저 보안 정책(CORS) 및 GeoJSON 로드를 위해, VS Code의 **Live Server** 확장 프로그램을 사용하거나 로컬 웹 서버(localhost) 환경에서 실행해야 정상 작동합니다.
3.  지도의 빈 곳을 클릭하여 **내 위치**를 설정합니다.
4.  우측 입력창에 **강수량(예: 120)**을 입력하고 **[시뮬레이션 실행]** 버튼을 누릅니다.

## 8. 프로젝트의 차별점
* **Live Data Processing**: 더미 데이터를 사용하지 않고, 공공 API를 통해 받아온 **5,000건 이상의 실제 데이터**를 프론트엔드에서 실시간으로 파싱 및 렌더링합니다.
* **Visual Storytelling**: 위험 구역에 **Pulse Animation(맥박 효과)**을 적용하여 재난 상황의 긴급함을 시각적으로 강조했습니다.
* **Coordinate System Integration**: 서로 다른 좌표계(EPSG:5179, EPSG:4326)를 Proj4js로 실시간 변환하여 정밀한 위치 정보를 제공합니다.

---
© 2025 GunChi Project. All Rights Reserved.
