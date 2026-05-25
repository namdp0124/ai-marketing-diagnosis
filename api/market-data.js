function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function compact(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeItems(data) {
  const body = data && data.response && data.response.body ? data.response.body : data && data.body ? data.body : {};
  const rawItems = body.items && body.items.item ? body.items.item : body.items;
  if (!rawItems) return [];
  return Array.isArray(rawItems) ? rawItems : [rawItems];
}

function getBody(data) {
  if (data && data.response && data.response.body) return data.response.body;
  if (data && data.body) return data.body;
  return {};
}

function getHeader(data) {
  if (data && data.response && data.response.header) return data.response.header;
  if (data && data.header) return data.header;
  return {};
}

function countBy(items, getter) {
  const counts = new Map();
  items.forEach(item => {
    const key = compact(getter(item), "");
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasCoordinates(payload) {
  return parseNumber(payload.longitude) !== null && parseNumber(payload.latitude) !== null;
}

const DISTRICTS = {
  "동구": "29110",
  "서구": "29140",
  "남구": "29155",
  "북구": "29170",
  "광산구": "29200"
};

const REGION_TO_DISTRICT = {
  "충장로/동명동": "동구",
  "상무지구": "서구",
  "첨단지구": "광산구",
  "수완지구": "광산구",
  "전대후문": "북구",
  "양림동": "남구",
  "송정역": "광산구",
  "봉선동": "남구",
  "백운동/남구": "남구"
};

const INDUSTRY_KEYWORDS = {
  "카페": ["카페", "커피", "다방", "음료", "차"],
  "음식점": ["음식", "식당", "한식", "백반", "분식", "일식", "중식", "양식", "치킨", "피자", "고기", "갈비", "국수", "주점"],
  "뷰티": ["미용", "헤어", "네일", "피부", "속눈썹", "마사지", "화장품", "뷰티"],
  "의류": ["의류", "패션", "옷", "섬유", "신발", "잡화"],
  "학원": ["학원", "교습", "교육", "독서실", "공부방"],
  "공방/소품": ["공방", "공예", "소품", "선물", "문구", "생활용품", "인테리어"],
  "서비스": ["서비스", "수리", "세탁", "사진", "부동산", "상담", "운동", "헬스"]
};

function resolveDistrictName(payload) {
  const requested = compact(payload.district, "");
  if (DISTRICTS[requested]) return requested;
  const region = compact(payload.region, "");
  return REGION_TO_DISTRICT[region] || "동구";
}

function matchesIndustry(item, industry) {
  return matchesIndustryWithCodes(item, industry, []);
}

function matchesIndustryWithCodes(item, industry, industryCodes) {
  const codeSet = new Set(industryCodes.map(code => code.code).filter(Boolean));
  if (codeSet.size && codeSet.has(compact(item.indsSclsCd, ""))) return true;

  const keywords = INDUSTRY_KEYWORDS[industry] || [];
  if (!keywords.length) return false;
  const text = [
    item.indsLclsNm,
    item.indsMclsNm,
    item.indsSclsNm,
    item.ksicNm,
    item.bizesNm
  ].filter(Boolean).join(" ");
  return keywords.some(keyword => text.includes(keyword));
}

function buildDensityLabel(count, sampleSize) {
  if (!sampleSize) return "판단 보류";
  const ratio = count / sampleSize;
  if (count >= 40 || ratio >= 0.12) return "높음";
  if (count >= 15 || ratio >= 0.06) return "보통";
  return "낮음";
}

async function fetchApi({ serviceKey, path, params }) {
  const endpoint = `https://apis.data.go.kr/B553077/api/open/sdsc2/${path}`;
  const encodedServiceKey = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  const searchParams = new URLSearchParams({ ...params, type: "json" });

  const response = await fetch(`${endpoint}?serviceKey=${encodedServiceKey}&${searchParams.toString()}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("소상공인365 API 응답을 JSON으로 읽지 못했습니다. 인증키 상태를 확인해 주세요.");
  }

  if (!response.ok) {
    const header = getHeader(data);
    throw new Error(header.resultMsg || "소상공인365 API 호출에 실패했습니다.");
  }

  const header = getHeader(data);
  const resultCode = compact(header.resultCode, "00");
  if (resultCode !== "00" && resultCode !== "NORMAL_CODE") {
    throw new Error(header.resultMsg || "소상공인365 API에서 오류 응답을 받았습니다.");
  }

  return data;
}

async function fetchPagedItems({ serviceKey, path, params, maxPages }) {
  const firstPage = await fetchApi({
    serviceKey,
    path,
    params: { ...params, pageNo: "1", numOfRows: "1000" }
  });
  const firstBody = getBody(firstPage);
  const totalCount = Number(firstBody.totalCount || 0);
  let items = normalizeItems(firstPage);

  const totalPages = Math.ceil(totalCount / 1000);
  const pagesToFetch = Math.min(maxPages, totalPages || 1);
  for (let pageNo = 2; pageNo <= pagesToFetch; pageNo += 1) {
    const pageData = await fetchApi({
      serviceKey,
      path,
      params: { ...params, pageNo: String(pageNo), numOfRows: "1000" }
    });
    items = items.concat(normalizeItems(pageData));
  }

  return {
    items,
    totalCount,
    header: getHeader(firstPage),
    pagesFetched: pagesToFetch
  };
}

async function fetchIndustryCodes(serviceKey, industry) {
  const keywords = INDUSTRY_KEYWORDS[industry] || [];
  if (!keywords.length) return [];

  try {
    const data = await fetchApi({
      serviceKey,
      path: "smallUpjongList",
      params: { pageNo: "1", numOfRows: "1000" }
    });
    return normalizeItems(data)
      .map(item => {
        const name = compact(item.indsSclsNm, "");
        const text = [item.indsLclsNm, item.indsMclsNm, item.indsSclsNm].filter(Boolean).join(" ");
        const score = keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
        return {
          code: compact(item.indsSclsCd, ""),
          name,
          middleName: compact(item.indsMclsNm, ""),
          largeName: compact(item.indsLclsNm, ""),
          score
        };
      })
      .filter(item => item.code && item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"))
      .slice(0, 10);
  } catch (error) {
    return [];
  }
}

async function fetchNearbyZones({ serviceKey, longitude, latitude, radius }) {
  try {
    const data = await fetchApi({
      serviceKey,
      path: "storeZoneInRadius",
      params: {
        cx: String(longitude),
        cy: String(latitude),
        radius: String(radius),
        pageNo: "1",
        numOfRows: "20"
      }
    });
    return normalizeItems(data).slice(0, 6).map(item => ({
      id: compact(item.trarNo || item.trdarNo || item.mainTrarNo, ""),
      name: compact(item.mainTrarNm || item.trarNm || item.trdarNm || item.signguNm || item.adongNm, "상권명 미확인"),
      district: compact(item.signguNm || item.signguCd, ""),
      type: compact(item.trarTypeNm || item.trdarTypeNm || item.ctprvnNm, "")
    }));
  } catch (error) {
    return [];
  }
}

function summarizeStores({ items, industry, industryCodes }) {
  const sameIndustryItems = items.filter(item => matchesIndustryWithCodes(item, industry, industryCodes));
  const topCategories = countBy(items, item => item.indsMclsNm || item.indsLclsNm).slice(0, 5);
  return {
    sampleCount: items.length,
    sameIndustryCount: sameIndustryItems.length,
    competitionDensity: buildDensityLabel(sameIndustryItems.length, items.length),
    topCategories,
    sampleStores: items.slice(0, 6).map(item => ({
      name: compact(item.bizesNm, "상호명 없음"),
      category: compact(item.indsMclsNm || item.indsSclsNm || item.indsLclsNm, "업종 미분류"),
      smallCategory: compact(item.indsSclsNm, ""),
      dong: compact(item.adongNm || item.ldongNm, ""),
      address: compact(item.rdnmAdr || item.lnoAdr, ""),
      longitude: compact(item.lon || item.longitude, ""),
      latitude: compact(item.lat || item.latitude, "")
    }))
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST 요청만 사용할 수 있습니다." });
  }

  const serviceKey = process.env.SMALLBIZ365_SERVICE_KEY || process.env.SMALLBIZ_API_KEY;
  if (!serviceKey) {
    return sendJson(res, 500, {
      error: "Vercel 환경변수 SMALLBIZ365_SERVICE_KEY가 아직 등록되지 않았습니다."
    });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return sendJson(res, 400, { error: "요청 데이터를 읽을 수 없습니다." });
    }
  }

  if (!payload || typeof payload !== "object") {
    return sendJson(res, 400, { error: "상권 조회에 필요한 정보가 부족합니다." });
  }

  const districtName = resolveDistrictName(payload);
  const districtCode = DISTRICTS[districtName];
  const dongName = compact(payload.dongName, "");
  const industry = compact(payload.industry, "기타");
  const longitude = parseNumber(payload.longitude);
  const latitude = parseNumber(payload.latitude);
  const radius = Math.max(100, Math.min(3000, Math.round(parseNumber(payload.radius) || 500)));
  const maxPages = Math.max(1, Math.min(3, Number(process.env.SMALLBIZ365_MAX_PAGES) || 2));

  try {
    const industryCodes = await fetchIndustryCodes(serviceKey, industry);
    const districtData = await fetchPagedItems({
      serviceKey,
      path: "storeListInDong",
      params: { divId: "signguCd", key: districtCode },
      maxPages
    });
    const totalCount = districtData.totalCount;
    const items = districtData.items;

    const filteredItems = dongName
      ? items.filter(item => compact(item.adongNm, "").includes(dongName) || compact(item.ldongNm, "").includes(dongName) || compact(item.rdnmAdr, "").includes(dongName) || compact(item.lnoAdr, "").includes(dongName))
      : items;
    const targetItems = filteredItems.length ? filteredItems : items;
    const administrative = summarizeStores({ items: targetItems, industry, industryCodes });
    const topDongs = countBy(items, item => item.adongNm).slice(0, 5);
    const header = districtData.header;
    const areaName = dongName ? `${districtName} ${dongName}` : districtName;
    let primary = administrative;
    let radiusAnalysis = null;
    let nearbyZones = [];

    if (longitude !== null && latitude !== null) {
      const radiusData = await fetchPagedItems({
        serviceKey,
        path: "storeListInRadius",
        params: {
          radius: String(radius),
          cx: String(longitude),
          cy: String(latitude)
        },
        maxPages
      });
      radiusAnalysis = {
        ...summarizeStores({ items: radiusData.items, industry, industryCodes }),
        radiusMeters: radius,
        totalCount: radiusData.totalCount,
        pagesFetched: radiusData.pagesFetched
      };
      primary = radiusAnalysis.sampleCount ? radiusAnalysis : primary;
      nearbyZones = await fetchNearbyZones({ serviceKey, longitude, latitude, radius });
    }

    const categoryText = primary.topCategories.map(item => `${item.name} ${item.count}개`).join(", ") || "분류 데이터 없음";
    const sampleNote = targetItems.length === filteredItems.length && dongName
      ? `${areaName} 표본 ${targetItems.length}개`
      : `${districtName} 표본 ${targetItems.length}개`;
    const radiusText = radiusAnalysis
      ? ` 매장 좌표 기준 반경 ${radius}m 표본 ${radiusAnalysis.sampleCount}개 중 ${industry} 유사 업소 ${radiusAnalysis.sameIndustryCount}개, 경쟁 밀도는 ${radiusAnalysis.competitionDensity}입니다.`
      : "";
    const codeText = industryCodes.length
      ? ` 공식 업종 소분류 후보는 ${industryCodes.slice(0, 3).map(item => item.name).join(", ")}입니다.`
      : "";
    const zoneText = nearbyZones.length
      ? ` 주변 상권 후보는 ${nearbyZones.map(zone => zone.name).join(", ")}입니다.`
      : "";

    return sendJson(res, 200, {
      ok: true,
      source: "소상공인시장진흥공단 상가(상권)정보 API",
      standardMonth: compact(header.stdrYm, ""),
      query: {
        region: compact(payload.region, ""),
        districtName,
        districtCode,
        dongName,
        industry,
        longitude,
        latitude,
        radius,
        pagesFetched: districtData.pagesFetched
      },
      analysisMode: radiusAnalysis ? "radius" : "administrative",
      totalCount,
      sampleCount: primary.sampleCount,
      sameIndustryCount: primary.sameIndustryCount,
      competitionDensity: primary.competitionDensity,
      topCategories: primary.topCategories,
      topDongs,
      sampleStores: primary.sampleStores,
      industryCodes,
      administrative: {
        areaName,
        sampleCount: administrative.sampleCount,
        sameIndustryCount: administrative.sameIndustryCount,
        competitionDensity: administrative.competitionDensity,
        topCategories: administrative.topCategories,
        sampleStores: administrative.sampleStores
      },
      radiusAnalysis,
      nearbyZones,
      summary: `${sampleNote} 기준 ${industry} 유사 업소 ${administrative.sameIndustryCount}개가 잡혔고, 경쟁 밀도는 ${administrative.competitionDensity}으로 보입니다.${radiusText} 주요 업종은 ${categoryText}입니다.${codeText}${zoneText}`,
      note: dongName && !filteredItems.length
        ? "입력한 행정동명이 표본에 없어 행정구 표본으로 요약했습니다."
        : "총 업소 수는 행정구 기준이며, 업종/행정동/반경 분석은 조회 표본 기준입니다."
    });
  } catch (error) {
    return sendJson(res, 502, {
      error: error.message || "소상공인365 상권 데이터를 불러오지 못했습니다."
    });
  }
};
