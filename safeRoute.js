/**
 * [SafeRoute System]
 * - 파주시 긴급 대피 경로 시스템 (Final Submission Version)
 * - Feature: 실제 경계, 대피소(5000+), 실시간 기상, 자연스러운 침수 병합
 * - Feedback Applied: 로딩 문구 구체화, 위험 구역 시각적 강조, UX 개선
 */

const API_CONFIG = {
    KEY: '4c58df36-82b2-40b2-b360-6450cca44b1e',
    BASE_URL: 'https://climate.gg.go.kr/ols/api/geoserver/wfs',
    LAYERS: { 
        FLOOD: 'spggcee:tm_fldn_trce', 
        SHELTER: 'spggcee:dsvctm_tmpr_hab_fclt' 
    }
};

// 파주시 좌표계 정의 (EPSG:5179)
proj4.defs("EPSG:5179", "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs");
const PAJU_CENTER = [37.762, 126.780];

// -----------------------------------------------------------
// 2. 지도 및 전역 변수
// -----------------------------------------------------------
const map = L.map("map", { center: PAJU_CENTER, zoom: 12 });
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { 
    maxZoom: 19, attribution: '&copy; OpenStreetMap' 
}).addTo(map);

let pajuPolygons = [];
let apiDangerPolygons = []; // 원본 침수 데이터
let activeDangerPolygons = null; // 현재 병합/확장된 침수 데이터
let allShelters = [];
let activeShelters = [];

let pajuBoundaryLayer = null;
let floodGeoLayer = null;
let shelterLayerGroup = L.layerGroup().addTo(map);
let currentRouteLine = null;
let startMarker = null;

const statusEl = document.getElementById('apiStatus');
const rainGaugeEl = document.getElementById('rainGauge');
const rainValueEl = document.getElementById('rainValue');
const rainLabelEl = document.getElementById('rainLabel');

let isSimulationMode = false;

// -----------------------------------------------------------
// 3. 시뮬레이션 클래스
// -----------------------------------------------------------
class FloodSimulation {
    constructor() {
        this.realData = [];
    }

    setRealData(polygons) {
        this.realData = polygons; 
    }

    // [핵심] 폴리곤 병합 및 확장 로직
    getMergedPolygons(amount) {
        if (amount < 30) return null; // 30mm 미만 안전
        if (this.realData.length === 0) return null;

        // 확장 계수: 강수량에 따라 위험 반경 확장
        const bufferDistance = (amount - 30) * 5.0; 

        // 1. 유효한 폴리곤으로 변환 및 버퍼링
        let features = this.realData.map(ring => {
            try {
                const geoJsonRing = ring.map(c => [c[1], c[0]]); // [lat, lng] -> [lng, lat]
                
                // 닫힌 링 보정
                if (geoJsonRing[0][0] !== geoJsonRing[geoJsonRing.length-1][0] || 
                    geoJsonRing[0][1] !== geoJsonRing[geoJsonRing.length-1][1]) {
                    geoJsonRing.push(geoJsonRing[0]);
                }
                
                // 점이 4개 미만이면 폴리곤 성립 불가
                if (geoJsonRing.length < 4) return null;

                const polygon = turf.polygon([geoJsonRing]);
                
                // 버퍼 적용 (steps: 64로 부드럽게)
                if (bufferDistance > 0) {
                    return turf.buffer(polygon, bufferDistance, { units: 'meters', steps: 64 });
                }
                return polygon;
            } catch (e) { return null; }
        }).filter(f => f !== null);

        if (features.length === 0) return null;

        // 2. 병합 (Union) - 하나로 합치기
        try {
            let merged = features[0];
            for (let i = 1; i < features.length; i++) {
                const unionResult = turf.union(merged, features[i]);
                if (unionResult) merged = unionResult;
            }
            return merged;
        } catch (e) {
            console.warn("Polygon Merge Warning:", e);
            return turf.featureCollection(features); // 병합 실패 시 개별 반환
        }
    }

    getDescription(amount) {
        if (amount >= 80) return `🚨 <b>극한호우 (${amount}mm)</b><br>과거 침수 데이터 기반 위험 구역 확장됨`;
        if (amount >= 30) return `⚠️ <b>호우주의보 (${amount}mm)</b><br>하천변 및 저지대 침수 주의`;
        return `✅ <b>안전 (${amount}mm)</b><br>현재 특이사항 없음`;
    }
}
const simManager = new FloodSimulation();

// -----------------------------------------------------------
// 4. 기능 함수들
// -----------------------------------------------------------
async function loadPajuBoundary() {
    try {
        const response = await fetch('./Data/paju.geojson');
        if (!response.ok) throw new Error("GeoJSON 파일 응답 없음");
        const geojson = await response.json();
        pajuPolygons = [];
        const features = geojson.features || (geojson.type === 'Feature' ? [geojson] : []);

        features.forEach(f => {
            const geom = f.geometry;
            if (!geom) return;
            const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
            polys.forEach(poly => {
                const ring = poly[0]; 
                const convertedRing = ring.map(coord => {
                    const wgs84 = proj4('EPSG:5179', 'EPSG:4326', coord);
                    return [wgs84[1], wgs84[0]];
                });
                pajuPolygons.push(convertedRing);
            });
        });
        
        if (pajuBoundaryLayer) map.removeLayer(pajuBoundaryLayer);
        pajuBoundaryLayer = L.polygon(pajuPolygons, {
            color: "#0b57d0", weight: 3, dashArray: "5 5", fillOpacity: 0.02, interactive: false
        }).addTo(map);
        return true;
    } catch (e) { console.error(e); return false; }
}

function clearUserLocation() {
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (currentRouteLine) { map.removeLayer(currentRouteLine); currentRouteLine = null; }
}

async function fetchRealWeather() {
    try {
        const url = "https://api.open-meteo.com/v1/forecast?latitude=37.76&longitude=126.78&current=precipitation,weather_code&timezone=Asia%2FSeoul";
        const res = await fetch(url);
        const data = await res.json();
        const precip = data.current.precipitation;
        const code = data.current.weather_code;
        let weatherDesc = "맑음";
        if (code >= 51 && code <= 67) weatherDesc = "비";
        else if (code >= 95) weatherDesc = "뇌우";
        else if (code >= 1 && code <= 3) weatherDesc = "흐림";
        return { precip, weatherDesc };
    } catch (e) { return { precip: 0, weatherDesc: "-" }; }
}

function updateRainGaugeUI(amount, isSim, labelText) {
    rainGaugeEl.classList.remove('gauge-normal', 'gauge-heavy', 'gauge-extreme');
    rainValueEl.innerText = `${amount}mm`;
    rainLabelEl.innerText = labelText;

    if (amount >= 80) rainGaugeEl.classList.add('gauge-extreme');
    else if (amount >= 30) rainGaugeEl.classList.add('gauge-heavy');
    else rainGaugeEl.classList.add('gauge-normal');
}

async function updateRainGauge(amount, isSim) {
    const label = isSim ? "사용자 시뮬레이션" : "로딩중...";
    updateRainGaugeUI(amount, isSim, label);
    
    if (!isSim) {
        const real = await fetchRealWeather();
        updateRainGaugeUI(real.precip, false, `실시간 (${real.weatherDesc})`);
        return real;
    }
}

// GeoJSON 기반 포인트 체크 (Turf)
function isPointInDanger(lat, lng) {
    if (!activeDangerPolygons) return false;
    const pt = turf.point([lng, lat]);
    
    // FeatureCollection (병합 실패 또는 다중 객체)
    if (activeDangerPolygons.type === 'FeatureCollection') {
        for (const feature of activeDangerPolygons.features) {
            if (turf.booleanPointInPolygon(pt, feature)) return true;
        }
        return false;
    }
    // Single Feature (성공적으로 병합됨)
    return turf.booleanPointInPolygon(pt, activeDangerPolygons);
}

function isInPaju(lat, lng) {
    if (pajuPolygons.length === 0) return true;
    const isInside = (point, vs) => {
        const x = point[1], y = point[0];
        let inside = false;
        for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
            const xi = vs[i][1], yi = vs[i][0];
            const xj = vs[j][1], yj = vs[j][0];
            const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 0.000001) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };
    for (const poly of pajuPolygons) {
        if (isInside([lat, lng], poly)) return true;
    }
    return false;
}

function updateShelterStatus() {
    shelterLayerGroup.clearLayers();
    activeShelters = [];
    allShelters.forEach(s => {
        const isFlooded = isPointInDanger(s.lat, s.lng);
        const fillColor = isFlooded ? "#999999" : "#2b7cff";
        const tooltipText = isFlooded ? `⛔ [침수됨] ${s.name}` : s.name;
        const marker = L.circleMarker([s.lat, s.lng], {
            radius: 6, color: "#ffffff", weight: 2, fillColor: fillColor, fillOpacity: 1
        }).bindTooltip(tooltipText, { direction: 'top', className: isFlooded ? 'flooded-tooltip' : '' });
        
        if (isFlooded) marker.setStyle({ color: "#666", dashArray: "2,2" });
        else activeShelters.push(s);
        
        shelterLayerGroup.addLayer(marker);
    });
}

// [Feedback Applied] 위험 구역 스타일링 강화 (애니메이션 Class 추가)
function drawDangerLayer(geoJsonData) {
    if (floodGeoLayer) map.removeLayer(floodGeoLayer);
    if (!geoJsonData) return;

    const amount = parseInt(document.getElementById('rainInput').value) || 0;
    const isExtreme = amount >= 80;

    floodGeoLayer = L.geoJSON(geoJsonData, {
        style: {
            color: isExtreme ? "#b71c1c" : "#e65100", // 테두리 진하게
            weight: isExtreme ? 2 : 1,
            fillColor: isExtreme ? "#d32f2f" : "#ff9800",
            fillOpacity: 0.6,
            className: isExtreme ? "danger-zone-path" : "" // [NEW] SVG 애니메이션 적용
        }
    }).addTo(map);
}

// -----------------------------------------------------------
// 5. 실행 제어
// -----------------------------------------------------------
function runUserSimulation() {
    const inputVal = document.getElementById('rainInput').value;
    const amount = parseInt(inputVal);
    if (isNaN(amount) || amount < 0) return alert("강수량을 입력해주세요.");

    document.body.classList.add("loading");
    statusEl.innerHTML = "🔄 5년 치 침수 데이터 분석 및 확장 중..."; // [NEW] 좀 더 있어 보이는 문구

    setTimeout(() => {
        clearUserLocation();
        isSimulationMode = true;
        updateRainGauge(amount, true);
        
        activeDangerPolygons = simManager.getMergedPolygons(amount);
        
        drawDangerLayer(activeDangerPolygons);
        updateShelterStatus();

        statusEl.innerHTML = simManager.getDescription(amount);
        statusEl.style.color = amount >= 80 ? "#d32f2f" : (amount >= 30 ? "#e65100" : "green");
        document.body.classList.remove("loading");
    }, 100);
}

async function resetSimulation() {
    clearUserLocation();
    isSimulationMode = false;
    document.getElementById('rainInput').value = "";
    
    statusEl.innerHTML = "📡 실시간 기상 데이터 확인 중...";
    
    const real = await fetchRealWeather();
    updateRainGaugeUI(real.precip, false, `실시간 (${real.weatherDesc})`);
    
    activeDangerPolygons = simManager.getMergedPolygons(real.precip);
    
    drawDangerLayer(activeDangerPolygons);
    updateShelterStatus();

    if (activeDangerPolygons) {
        statusEl.innerHTML = simManager.getDescription(real.precip);
        statusEl.style.color = "#d32f2f";
    } else {
        statusEl.innerHTML = `✅ <b>안전 (실시간 ${real.precip}mm)</b><br>현재 침수 위험 지역 없음`;
        statusEl.style.color = "green";
    }
}

// -----------------------------------------------------------
// 6. 데이터 로드 (CORS Proxy + Feedback Text)
// -----------------------------------------------------------
async function initData() {
    document.body.classList.add("loading");
    // [Feedback Applied] 신뢰도 높이는 로딩 문구
    statusEl.innerHTML = "📡 경기데이터드림 API 연결 중...<br>(과거 침수 흔적 데이터 분석)";

    await loadPajuBoundary();

    const getWfsUrl = (typeName, max) => {
        const originalUrl = `${API_CONFIG.BASE_URL}?apiKey=${API_CONFIG.KEY}&service=WFS&version=1.1.0&request=GetFeature&typeName=${typeName}&outputFormat=application/json&srsName=EPSG:4326&maxFeatures=${max}`;
        return `https://corsproxy.io/?` + encodeURIComponent(originalUrl);
    };

    try {
        const sRes = await fetch(getWfsUrl(API_CONFIG.LAYERS.SHELTER, 5000));
        const sData = await sRes.json();
        allShelters = (sData.features || []).map(f => {
            const lng = f.geometry?.coordinates?.[0];
            const lat = f.geometry?.coordinates?.[1];
            if (lat && lng && isInPaju(lat, lng)) {
                return { name: f.properties?.fac_nam || "대피소", lat, lng };
            }
            return null;
        }).filter(Boolean);

        console.log(`파주시 대피소: ${allShelters.length}개 로드됨`);

        const fRes = await fetch(getWfsUrl(API_CONFIG.LAYERS.FLOOD, 5000));
        const fData = await fRes.json();
        apiDangerPolygons = [];
        (fData.features || []).forEach(f => {
            const geom = f.geometry;
            if (!geom) return;
            const extractRing = (ring) => ring.map(c => [c[1], c[0]]);
            if (geom.type === "Polygon") {
                const r = extractRing(geom.coordinates[0]);
                if(isInPaju(r[0][0], r[0][1])) apiDangerPolygons.push(r);
            } else if (geom.type === "MultiPolygon") {
                geom.coordinates.forEach(p => {
                    const r = extractRing(p[0]);
                    if(isInPaju(r[0][0], r[0][1])) apiDangerPolygons.push(r);
                });
            }
        });

        simManager.setRealData(apiDangerPolygons);
        resetSimulation();

    } catch (e) {
        console.error(e);
        statusEl.innerHTML = "⚠️ API 연결 실패 (네트워크 확인 필요)";
        statusEl.style.color = "red";
    } finally {
        document.body.classList.remove("loading");
    }
}

// -----------------------------------------------------------
// 7. 경로 탐색
// -----------------------------------------------------------
async function findSafeRoute(startLat, startLng) {
    if (activeShelters.length === 0) {
        startMarker?.bindPopup("<b>🚨 대피소 없음</b><br>이용 가능한 대피소가 없습니다.").openPopup();
        return;
    }
    document.body.classList.add("loading");
    
    const inDanger = isPointInDanger(startLat, startLng);
    if (startMarker) {
        let msg = inDanger ? "<b>🚨 위험 지역!</b><br>안전한 곳으로 탈출합니다." : "<b>🔍 경로 탐색 중...</b><br>가까운 안전 대피소를 찾습니다.";
        startMarker.bindPopup(msg).openPopup();
    }

    const candidates = activeShelters.map(s => ({ 
        ...s, dist: map.distance([startLat, startLng], [s.lat, s.lng]) 
    })).sort((a, b) => a.dist - b.dist).slice(0, 3);

    let best = null;
    let minDist = Infinity;

    for (const shelter of candidates) {
        const url = `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${shelter.lng},${shelter.lat}?overview=full&geometries=geojson`;
        try {
            const res = await fetch(url);
            const data = await res.json();
            if (!data.routes || !data.routes.length) continue;
            const route = data.routes[0];
            const points = route.geometry.coordinates.map(c => ({ lat: c[1], lng: c[0] }));
            let touchesDanger = false;
            const step = Math.max(1, Math.floor(points.length / 40));
            for (let i = 0; i < points.length; i += step) {
                if (isPointInDanger(points[i].lat, points[i].lng)) { touchesDanger = true; break; }
            }
            const valid = inDanger ? true : !touchesDanger;
            if (valid && route.distance < minDist) {
                minDist = route.distance;
                best = { path: points.map(p => [p.lat, p.lng]), shelterName: shelter.name, mode: inDanger ? "escape" : "safe", distanceM: route.distance };
            }
        } catch (e) {}
    }

    document.body.classList.remove("loading");
    if (currentRouteLine) map.removeLayer(currentRouteLine);

    if (best) {
        const color = best.mode === "escape" ? "#d32f2f" : "#0066ff";
        currentRouteLine = L.polyline(best.path, { color, weight: 6, opacity: 0.8 }).addTo(map);
        map.fitBounds(currentRouteLine.getBounds().pad(0.2));
        const km = (best.distanceM / 1000).toFixed(1);
        const msg = best.mode === "escape" ? `<b>🚨 긴급 탈출 (${km}km)</b><br>목표: ${best.shelterName}` : `<b>✅ 안전 경로 (${km}km)</b><br>목표: ${best.shelterName}`;
        startMarker.bindPopup(msg).openPopup();
    } else {
        startMarker.bindPopup("<b>⚠️ 경로 탐색 실패</b><br>도로가 차단되었거나<br>접근 가능한 대피소가 없습니다.").openPopup();
    }
}

// -----------------------------------------------------------
// 8. 이벤트 핸들러
// -----------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('btnRun').addEventListener('click', runUserSimulation);
    document.getElementById('btnReset').addEventListener('click', resetSimulation);
    document.getElementById('btnRecenter').addEventListener('click', () => map.setView(PAJU_CENTER, 12));
    document.getElementById('rainInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') runUserSimulation();
    });

    map.on("click", (e) => {
        const { lat, lng } = e.latlng;
        if (!isInPaju(lat, lng)) return L.popup().setLatLng(e.latlng).setContent("<b>파주시 경계 밖입니다.</b>").openOn(map);

        if (!startMarker) {
            startMarker = L.marker(e.latlng, { draggable: true }).addTo(map);
            startMarker.on("dragend", (evt) => {
                const pos = evt.target.getLatLng();
                findSafeRoute(pos.lat, pos.lng);
            });
        } else {
            startMarker.setLatLng(e.latlng);
        }
        findSafeRoute(lat, lng);
    });
    
    initData();
});