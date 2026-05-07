(function () {
    const DEFAULT_RADIUS_METERS = 500;
    const SEARCH_DELAY_MS = 260;
    const DEFAULT_CENTER = [87.6168, 43.8256];
    const BUILD_VERSION = "20260507-uploadmock";
    const MOCK_UPLOAD_DELAY_MS = 480;
    const CHECKIN_STORAGE_KEY = "red-map-checkins";
    const IMAGE_MAX_WIDTH = 1280;
    const IMAGE_INITIAL_QUALITY = 0.82;
    const IMAGE_MAX_DATA_LENGTH = 520000;

    const defaultConfig = {
        dataUrl: "data/sites.json",
        qrApiTemplate: "https://api.qrserver.com/v1/create-qr-code/?size=280x280&data={url}",
        deployment: {
            forceBaseUrl: ""
        },
        amap: {
            key: "",
            securityJsCode: "",
            city: "乌鲁木齐市",
            cityCode: "650100",
            mapStyle: "amap://styles/whitesmoke"
        },
        backend: {
            mode: "local-storage",
            supabase: {
                url: "",
                anonKey: "",
                table: "activity_checkins"
            },
            localApi: {
                baseUrl: ""
            }
        }
    };

    const appConfig = mergeConfig(defaultConfig, window.RED_MAP_CONFIG || {});
    const backend = createBackend(appConfig);

    const state = {
        project: null,
        featuredSites: [],
        liveSites: [],
        displayedSites: [],
        districts: [],
        activeDistrict: "全部地区",
        searchText: "",
        selectedSiteId: null,
        currentPosition: null,
        checkinsBySite: new Map(),
        loadingCheckins: new Set(),
        mapReady: false,
        AMap: null,
        map: null,
        siteCardDismissed: false,
        geolocationMarker: null,
        markers: [],
        searchTimer: null,
        latestSearchToken: 0,
        placeSearch: null
    };

    const elements = {
        projectTitle: document.getElementById("projectTitle"),
        projectSubtitle: document.getElementById("projectSubtitle"),
        searchInput: document.getElementById("searchInput"),
        siteCount: document.getElementById("siteCount"),
        distanceHint: document.getElementById("distanceHint"),
        districtTabs: document.getElementById("districtTabs"),
        siteList: document.getElementById("siteList"),
        siteCard: document.getElementById("siteCard"),
        toast: document.getElementById("toast"),
        sheet: document.getElementById("sheet"),
        sheetToggle: document.getElementById("sheetToggle"),
        sheetState: document.getElementById("sheetState"),
        locateButton: document.getElementById("locateButton"),
        zoomInButton: document.getElementById("zoomInButton"),
        zoomOutButton: document.getElementById("zoomOutButton"),
        resetViewButton: document.getElementById("resetViewButton"),
        realMap: document.getElementById("realMap"),
        mapFallback: document.getElementById("mapFallback")
    };

    init();

    async function init() {
        bindEvents();
        await Promise.all([
            loadData(),
            initMap()
        ]);
        await applyFilters();
        requestLocation({ silent: true });
    }

    function bindEvents() {
        elements.searchInput.addEventListener("input", function (event) {
            state.searchText = event.target.value.trim();
            scheduleSearch();
        });

        elements.sheetToggle.addEventListener("click", function () {
            elements.sheet.classList.toggle("is-open");
            elements.sheetState.textContent = elements.sheet.classList.contains("is-open") ? "收起" : "展开";
        });

        elements.locateButton.addEventListener("click", function () {
            requestLocation({ silent: false, focusNearest: true });
        });

        elements.zoomInButton.addEventListener("click", function () {
            if (state.mapReady) {
                state.map.zoomIn();
            }
        });

        elements.zoomOutButton.addEventListener("click", function () {
            if (state.mapReady) {
                state.map.zoomOut();
            }
        });

        elements.resetViewButton.addEventListener("click", function () {
            if (state.mapReady) {
                state.map.setZoomAndCenter(11, DEFAULT_CENTER, false, 260);
            }
        });
    }

    async function loadData() {
        const payload = await resolveProjectData();
        state.project = payload.project || {};
        state.featuredSites = (payload.sites || []).map(function (site) {
            return normalizeSite(site, "featured");
        });
        state.districts = buildDistricts(state.featuredSites);

        elements.projectTitle.textContent = state.project.title || "乌鲁木齐红色地图打卡";
        elements.projectSubtitle.textContent = state.project.subtitle || "场馆检索 / 距离提示 / 现场记录";
    }

    async function initMap() {
        const amapConfig = appConfig.amap || {};
        if (!amapConfig.key) {
            showMapFallback();
            return;
        }

        try {
            if (amapConfig.securityJsCode) {
                window._AMapSecurityConfig = {
                    securityJsCode: amapConfig.securityJsCode
                };
            }

            await loadExternalScript("https://webapi.amap.com/loader.js?v=" + encodeURIComponent(BUILD_VERSION));
            const AMap = await window.AMapLoader.load({
                key: amapConfig.key,
                version: "2.0",
                plugins: ["AMap.PlaceSearch", "AMap.Scale", "AMap.ToolBar"]
            });

            state.AMap = AMap;
            state.map = new AMap.Map("realMap", {
                zoom: 11,
                center: DEFAULT_CENTER,
                resizeEnable: true,
                mapStyle: amapConfig.mapStyle || "amap://styles/whitesmoke"
            });

            state.map.addControl(new AMap.Scale());
            state.map.addControl(new AMap.ToolBar({
                position: {
                    top: "12px",
                    right: "12px"
                }
            }));

            state.placeSearch = new AMap.PlaceSearch({
                city: amapConfig.cityCode || amapConfig.city || "650100",
                citylimit: true,
                pageSize: 12,
                pageIndex: 1,
                map: null,
                autoFitView: false
            });

            state.mapReady = true;
            elements.realMap.classList.remove("is-hidden");
            elements.mapFallback.classList.add("is-hidden");
        } catch (error) {
            showMapFallback();
        }
    }

    function showMapFallback() {
        elements.realMap.classList.add("is-hidden");
        elements.mapFallback.classList.remove("is-hidden");
    }

    function scheduleSearch() {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = window.setTimeout(function () {
            applyFilters();
        }, SEARCH_DELAY_MS);
    }

    async function applyFilters() {
        const keyword = state.searchText.trim().toLowerCase();
        const localMatches = filterFeaturedSites(keyword);
        const searchToken = ++state.latestSearchToken;

        if (!keyword) {
            state.liveSites = [];
            state.displayedSites = localMatches;
            renderEverything();
            return;
        }

        if (!state.mapReady) {
            state.liveSites = [];
            state.displayedSites = localMatches;
            renderEverything();
            return;
        }

        try {
            const liveSites = await searchAmapPois(keyword, searchToken);
            if (searchToken !== state.latestSearchToken) {
                return;
            }
            state.liveSites = liveSites;
            state.displayedSites = filterByDistrict(mergeSites(localMatches, liveSites));
        } catch (error) {
            if (searchToken !== state.latestSearchToken) {
                return;
            }
            state.liveSites = [];
            state.displayedSites = localMatches;
        }

        renderEverything();
    }

    function filterFeaturedSites(keyword) {
        return filterByDistrict(state.featuredSites.filter(function (site) {
            if (!keyword) {
                return true;
            }

            const haystack = [site.name, site.district, site.address, site.tag, site.description]
                .concat(site.aliases || [])
                .join(" ")
                .toLowerCase();

            return haystack.includes(keyword);
        }));
    }

    function filterByDistrict(sites) {
        return sites.filter(function (site) {
            return state.activeDistrict === "全部地区" || site.district === state.activeDistrict;
        });
    }

    function mergeSites(localMatches, liveSites) {
        const merged = [];
        const seen = new Set();

        localMatches.concat(liveSites).forEach(function (site) {
            const key = (site.name + "|" + site.address).toLowerCase();
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            merged.push(site);
        });

        return merged;
    }

    function renderEverything() {
        sortSitesByDistance(state.displayedSites);
        renderDistrictTabs();
        renderSiteList();
        renderMapMarkers();
        syncSelectedSite();
        elements.siteCount.textContent = "当前结果 " + state.displayedSites.length + " 个地点";
        elements.distanceHint.textContent = state.mapReady
            ? "支持输入场馆名称或地址检索"
            : "当前展示活动点位";
    }

    function renderDistrictTabs() {
        elements.districtTabs.innerHTML = "";

        state.districts.forEach(function (district) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "district-chip" + (district === state.activeDistrict ? " is-active" : "");
            button.textContent = district;
            button.addEventListener("click", function () {
                state.activeDistrict = district;
                applyFilters();
            });
            elements.districtTabs.appendChild(button);
        });
    }

    function renderSiteList() {
        elements.siteList.innerHTML = "";

        if (!state.displayedSites.length) {
            const empty = document.createElement("p");
            empty.className = "empty-tip";
            empty.textContent = "没有找到匹配地点，请更换关键词后重试。";
            elements.siteList.appendChild(empty);
            return;
        }

        state.displayedSites.forEach(function (site) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "site-list-button";

            if (site.id === state.selectedSiteId) {
                button.classList.add("is-active");
            }
            if (isNearSite(site)) {
                button.classList.add("is-near");
            }

            const title = document.createElement("strong");
            title.textContent = site.name;

            const meta = document.createElement("small");
            meta.textContent = [site.district, site.tag, formatDistance(site)].filter(Boolean).join(" · ");

            button.appendChild(title);
            button.appendChild(meta);
            button.addEventListener("click", function () {
                selectSite(site.id, { focusMap: true });
            });
            elements.siteList.appendChild(button);
        });
    }

    function renderMapMarkers() {
        if (!state.mapReady) {
            return;
        }

        state.markers.forEach(function (marker) {
            marker.setMap(null);
        });
        state.markers = [];

        const AMap = state.AMap;
        state.displayedSites.forEach(function (site) {
            const marker = new AMap.Marker({
                position: [site.lng, site.lat],
                anchor: "bottom-center",
                offset: new AMap.Pixel(0, 4),
                content: buildMarkerHtml(site, site.id === state.selectedSiteId)
            });

            marker.on("click", function () {
                selectSite(site.id, { focusMap: true });
            });

            marker.setMap(state.map);
            state.markers.push(marker);
        });

        if (state.markers.length && !state.selectedSiteId) {
            state.map.setFitView(state.markers, false, [70, 70, 360, 120], 260);
        }
    }

    function buildMarkerHtml(site, isActive) {
        const classes = ["real-marker"];
        classes.push(site.source === "live" ? "is-live" : "is-featured");
        if (isActive) {
            classes.push("is-active");
        }

        return [
            "<div class=\"", classes.join(" "), "\">",
                "<span class=\"real-marker-pin\"></span>",
                "<span class=\"real-marker-label\">", escapeHtml(site.name), "</span>",
            "</div>"
        ].join("");
    }

    function syncSelectedSite() {
        const selectedVisible = state.displayedSites.some(function (site) {
            return site.id === state.selectedSiteId;
        });

        if (selectedVisible) {
            if (state.siteCardDismissed) {
                elements.siteCard.classList.add("is-hidden");
                return;
            }
            renderSiteCard(getSelectedSite());
            return;
        }

        if (state.displayedSites[0]) {
            selectSite(state.displayedSites[0].id, { focusMap: false });
            return;
        }

        state.selectedSiteId = null;
        elements.siteCard.classList.add("is-hidden");
    }

    function selectSite(siteId, options) {
        const settings = Object.assign({ focusMap: true }, options);
        const site = state.displayedSites.find(function (item) {
            return item.id === siteId;
        }) || state.featuredSites.find(function (item) {
            return item.id === siteId;
        }) || state.liveSites.find(function (item) {
            return item.id === siteId;
        });

        if (!site) {
            return;
        }

        state.selectedSiteId = site.id;
        state.siteCardDismissed = false;
        renderSiteList();
        renderMapMarkers();
        renderSiteCard(site);

        if (settings.focusMap && state.mapReady) {
            state.map.setZoomAndCenter(14, [site.lng, site.lat], false, 260);
        }

    }

    function getSelectedSite() {
        return state.displayedSites.find(function (site) {
            return site.id === state.selectedSiteId;
        }) || null;
    }

    function renderSiteCard(site) {
        if (!site) {
            elements.siteCard.classList.add("is-hidden");
            return;
        }

        elements.siteCard.innerHTML = [
            "<section class=\"site-card-visual\" style=\"--site-accent-start:", escapeAttribute(site.accentStart), ";--site-accent-end:", escapeAttribute(site.accentEnd), ";\">",
                "<button class=\"site-card-close\" type=\"button\" aria-label=\"关闭详情\" data-action=\"close-card\">×</button>",
                "<span class=\"site-tagline\">", escapeHtml(site.tag), "</span>",
                "<h3>", escapeHtml(site.name), "</h3>",
                "<p>", escapeHtml(site.address), "</p>",
            "</section>",
            "<section class=\"site-card-body\">",
                "<div class=\"site-meta-grid\">",
                    "<div class=\"site-meta-item\"><small>所属地区</small><strong>", escapeHtml(site.district || "乌鲁木齐"), "</strong></div>",
                    "<div class=\"site-meta-item\"><small>当前距离</small><strong>", escapeHtml(formatDistance(site)), "</strong></div>",
                    "<div class=\"site-meta-item\"><small>开放时间</small><strong>", escapeHtml(site.openHours || "以场馆当日信息为准"), "</strong></div>",
                    "<div class=\"site-meta-item\"><small>可上传范围</small><strong>", site.checkInRadiusMeters, " 米</strong></div>",
                "</div>",
                "<p class=\"site-description\">", escapeHtml(site.detail || site.description || "可直接导航前往现场。"), "</p>",
                "<div class=\"site-actions\">",
                    "<button class=\"site-primary-button\" type=\"button\" data-action=\"navigate\">导航前往</button>",
                    "<button class=\"site-secondary-button\" type=\"button\" data-action=\"focus\">地图定位</button>",
                "</div>",
                "<details class=\"upload-panel\">",
                    "<summary>现场照片上传</summary>",
                    "<p class=\"upload-copy\">可随时提交现场照片与文字记录，页面仍保留距离与范围提示供参考。</p>",
                    "<form id=\"checkinForm\" class=\"upload-fields\">",
                        "<div class=\"upload-field\">",
                            "<label for=\"visitorName\">姓名或团队</label>",
                            "<input id=\"visitorName\" name=\"visitorName\" type=\"text\" placeholder=\"请输入姓名或团支部名称\">",
                        "</div>",
                        "<div class=\"upload-field\">",
                            "<label for=\"visitNote\">现场说明</label>",
                            "<textarea id=\"visitNote\" name=\"visitNote\" placeholder=\"可填写参观内容、活动情况等\"></textarea>",
                        "</div>",
                        "<div class=\"upload-field\">",
                            "<label for=\"visitPhoto\">现场照片</label>",
                            "<input id=\"visitPhoto\" name=\"visitPhoto\" type=\"file\" accept=\"image/*\" capture=\"environment\">",
                        "</div>",
                        "<div id=\"uploadPreview\" class=\"upload-preview\"></div>",
                        "<button class=\"upload-button\" type=\"submit\">确认上传</button>",
                    "</form>",
                "</details>",
            "</section>"
        ].join("");

        elements.siteCard.classList.remove("is-hidden");

        const closeButton = elements.siteCard.querySelector("[data-action='close-card']");
        const navigateButton = elements.siteCard.querySelector("[data-action='navigate']");
        const focusButton = elements.siteCard.querySelector("[data-action='focus']");
        const uploadInput = document.getElementById("visitPhoto");
        const uploadPreview = document.getElementById("uploadPreview");
        const checkinForm = document.getElementById("checkinForm");

        closeButton.addEventListener("click", function () {
            hideSiteCard();
        });

        navigateButton.addEventListener("click", function () {
            openExternalUrl(buildNavigationUrl(site));
        });

        focusButton.addEventListener("click", function () {
            if (state.mapReady) {
                state.map.setZoomAndCenter(15, [site.lng, site.lat], false, 260);
                hideSiteCard();
                showToast("已定位到地图位置");
                return;
            }

            openExternalUrl(buildMapLocationUrl(site));
        });

        uploadInput.addEventListener("change", function (event) {
            const file = event.target.files && event.target.files[0];
            if (!file) {
                uploadPreview.style.display = "none";
                uploadPreview.innerHTML = "";
                return;
            }

            const reader = new FileReader();
            reader.onload = function () {
                uploadPreview.style.display = "block";
                uploadPreview.innerHTML = "<img src=\"" + escapeAttribute(reader.result) + "\" alt=\"上传预览\">";
            };
            reader.readAsDataURL(file);
        });

        checkinForm.addEventListener("submit", function (event) {
            event.preventDefault();
            submitCheckin(site, checkinForm);
        });
    }

    function renderCheckins(checkins) {
        if (!checkins.length) {
            return "<p class=\"empty-tip\">当前地点暂无上传记录。</p>";
        }

        return "<div class=\"checkin-list\">" + checkins.slice(0, 4).map(function (item) {
            const photo = item.photoUrl
                ? "<img class=\"checkin-photo\" src=\"" + escapeAttribute(item.photoUrl) + "\" alt=\"现场照片\">"
                : "";

            return [
                "<article class=\"checkin-item\">",
                    "<strong>", escapeHtml(item.visitorName || "现场记录"), "</strong>",
                    "<small>", escapeHtml(formatCheckinTime(item.createdAt)), " · ", escapeHtml(item.distanceLabel || "未记录距离"), "</small>",
                    item.note ? "<p>" + escapeHtml(item.note) + "</p>" : "",
                    photo,
                "</article>"
            ].join("");
        }).join("") + "</div>";
    }

    async function loadCheckins(siteId) {
        state.loadingCheckins.add(siteId);
        try {
            const items = await backend.listCheckins(siteId);
            state.checkinsBySite.set(siteId, items);

            if (state.selectedSiteId === siteId) {
                if (!state.siteCardDismissed) {
                    renderSiteCard(getSelectedSite());
                }
            }
        } catch (error) {
            state.checkinsBySite.set(siteId, []);
            if (state.selectedSiteId === siteId) {
                if (!state.siteCardDismissed) {
                    renderSiteCard(getSelectedSite());
                }
            }
        } finally {
            state.loadingCheckins.delete(siteId);
        }
    }

    async function submitCheckin(site, form) {
        const visitorName = form.visitorName.value.trim();
        const file = form.visitPhoto.files && form.visitPhoto.files[0];
        const submitButton = form.querySelector(".upload-button");

        if (!visitorName) {
            showToast("请先填写姓名或团队");
            return;
        }

        if (!file) {
            showToast("请先选择现场照片");
            return;
        }

        try {
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.textContent = "上传中...";
            }

            await wait(MOCK_UPLOAD_DELAY_MS);
            form.reset();
            document.getElementById("uploadPreview").innerHTML = "";
            document.getElementById("uploadPreview").style.display = "none";

            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "确认上传";
            }

            showToast("上传成功");
        } catch (error) {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "确认上传";
            }
            showToast(error.message || "提交失败，请稍后重试");
        }
    }

    function wait(delayMs) {
        return new Promise(function (resolve) {
            window.setTimeout(resolve, delayMs);
        });
    }

    async function searchAmapPois(keyword, searchToken) {
        if (!state.placeSearch) {
            return [];
        }

        return new Promise(function (resolve, reject) {
            state.placeSearch.search(keyword, function (status, result) {
                if (searchToken !== state.latestSearchToken) {
                    resolve([]);
                    return;
                }

                if (status !== "complete" || !result || !result.poiList) {
                    reject(new Error("地图搜索失败"));
                    return;
                }

                const pois = result.poiList.pois || [];
                resolve(pois.filter(function (poi) {
                    return poi && poi.location && poi.location.lng != null && poi.location.lat != null;
                }).map(normalizeLivePoi));
            });
        });
    }

    function normalizeLivePoi(poi) {
        const district = poi.adname || poi.cityname || "乌鲁木齐";
        return {
            id: "live_" + (poi.id || generateId("poi")),
            source: "live",
            name: poi.name || "地图地点",
            district: district,
            tag: "地图检索",
            address: [district, poi.address || ""].filter(Boolean).join(" "),
            description: poi.type || "地图地点",
            detail: "地图检索结果，可查看位置、距离并导航前往。",
            openHours: "以场馆当日信息为准",
            lat: Number(poi.location.lat),
            lng: Number(poi.location.lng),
            accentStart: "#9b2027",
            accentEnd: "#e47c5f",
            checkInRadiusMeters: DEFAULT_RADIUS_METERS,
            aliases: []
        };
    }

    function normalizeSite(site, source) {
        const projectRadius = state.project && state.project.checkInRadiusMeters;
        return {
            id: site.id,
            source: source || "featured",
            name: site.name,
            district: site.district,
            tag: site.tag || "活动站点",
            address: site.address || "待补充地址",
            description: site.description || "",
            detail: site.detail || site.description || "",
            openHours: site.openHours || "以场馆当日信息为准",
            lat: Number(site.lat),
            lng: Number(site.lng),
            accentStart: site.accentStart || "#a81f26",
            accentEnd: site.accentEnd || "#db6a54",
            checkInRadiusMeters: Number(site.checkInRadiusMeters || projectRadius || DEFAULT_RADIUS_METERS),
            aliases: Array.isArray(site.aliases) ? site.aliases : []
        };
    }

    async function resolveProjectData() {
        try {
            const response = await fetch(appConfig.dataUrl + "?v=" + encodeURIComponent(BUILD_VERSION), { cache: "no-store" });
            if (!response.ok) {
                throw new Error("站点数据加载失败");
            }
            return response.json();
        } catch (error) {
            if (window.RED_MAP_SITE_DATA && Array.isArray(window.RED_MAP_SITE_DATA.sites)) {
                return window.RED_MAP_SITE_DATA;
            }
            throw error;
        }
    }

    async function loadExternalScript(src) {
        if (document.querySelector('script[data-src="' + src + '"]')) {
            return;
        }

        await new Promise(function (resolve, reject) {
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.dataset.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    function buildDistricts(sites) {
        const districts = Array.from(new Set(sites.map(function (site) {
            return site.district;
        }).filter(Boolean))).sort();
        return ["全部地区"].concat(districts);
    }

    function sortSitesByDistance(sites) {
        if (!state.currentPosition) {
            return;
        }

        sites.sort(function (left, right) {
            return getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, left.lat, left.lng)
                - getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, right.lat, right.lng);
        });
    }

    function requestLocation(options) {
        const settings = Object.assign({ silent: false, focusNearest: false }, options);
        if (!navigator.geolocation) {
            if (!settings.silent) {
                showToast("当前浏览器不支持定位");
            }
            return;
        }

        elements.distanceHint.textContent = "正在获取当前位置...";
        navigator.geolocation.getCurrentPosition(function (position) {
            state.currentPosition = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            updateCurrentLocationMarker();
            renderEverything();
            elements.distanceHint.textContent = "定位成功，可查看与地点距离";

            if (settings.focusNearest) {
                const nearest = getNearestDisplayedSite();
                if (nearest) {
                    selectSite(nearest.id, { focusMap: true });
                }
            }
        }, function () {
            elements.distanceHint.textContent = state.mapReady
                ? "支持输入场馆名称或地址检索"
                : "当前展示活动点位";
            if (!settings.silent) {
                showToast("定位失败，请检查浏览器定位权限");
            }
        }, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
        });
    }

    function updateCurrentLocationMarker() {
        if (!state.mapReady || !state.currentPosition) {
            return;
        }

        if (state.geolocationMarker) {
            state.geolocationMarker.setMap(null);
        }

        state.geolocationMarker = new state.AMap.Marker({
            position: [state.currentPosition.lng, state.currentPosition.lat],
            anchor: "center",
            content: "<div class=\"user-location-dot\"></div>"
        });
        state.geolocationMarker.setMap(state.map);
    }

    function getNearestDisplayedSite() {
        if (!state.currentPosition || !state.displayedSites.length) {
            return null;
        }

        return state.displayedSites.slice().sort(function (left, right) {
            return getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, left.lat, left.lng)
                - getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, right.lat, right.lng);
        })[0];
    }

    function canCheckInAtSite(site) {
        if (state.project && state.project.allowOffsiteUpload) {
            return true;
        }

        if (!state.currentPosition) {
            return false;
        }

        return getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, site.lat, site.lng) <= site.checkInRadiusMeters;
    }

    function isNearSite(site) {
        return canCheckInAtSite(site);
    }

    function hideSiteCard() {
        state.siteCardDismissed = true;
        elements.siteCard.classList.add("is-hidden");
    }

    function formatDistance(site) {
        if (!state.currentPosition) {
            return "待定位";
        }

        const distance = Math.round(getDistanceMeters(state.currentPosition.lat, state.currentPosition.lng, site.lat, site.lng));
        return distance < 1000 ? distance + " 米" : (distance / 1000).toFixed(1) + " 公里";
    }

    function getDistanceMeters(lat1, lng1, lat2, lng2) {
        const toRadians = Math.PI / 180;
        const deltaLat = (lat2 - lat1) * toRadians;
        const deltaLng = (lng2 - lng1) * toRadians;
        const lat1Rad = lat1 * toRadians;
        const lat2Rad = lat2 * toRadians;
        const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2)
            + Math.cos(lat1Rad) * Math.cos(lat2Rad)
            * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 6371000 * c;
    }

    function buildNavigationUrl(site) {
        return "https://uri.amap.com/navigation?to="
            + site.lng + "," + site.lat + "," + encodeURIComponent(site.name)
            + "&mode=walk&policy=1&src=red-map-app&coordinate=gaode&callnative=1";
    }

    function buildMapLocationUrl(site) {
        return "https://uri.amap.com/marker?position="
            + site.lng + "," + site.lat
            + "&name=" + encodeURIComponent(site.name)
            + "&src=red-map-app&coordinate=gaode";
    }

    function openExternalUrl(url) {
        const win = window.open(url, "_blank", "noopener");
        if (!win) {
            window.location.href = url;
        }
    }

    function fileToCompressedDataUrl(file) {
        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onload = function () {
                const image = new Image();
                image.onload = function () {
                    const ratio = image.width > IMAGE_MAX_WIDTH ? IMAGE_MAX_WIDTH / image.width : 1;
                    const canvas = document.createElement("canvas");
                    canvas.width = Math.round(image.width * ratio);
                    canvas.height = Math.round(image.height * ratio);
                    const context = canvas.getContext("2d");
                    context.drawImage(image, 0, 0, canvas.width, canvas.height);

                    let quality = IMAGE_INITIAL_QUALITY;
                    let dataUrl = canvas.toDataURL("image/jpeg", quality);
                    while (dataUrl.length > IMAGE_MAX_DATA_LENGTH && quality > 0.45) {
                        quality -= 0.08;
                        dataUrl = canvas.toDataURL("image/jpeg", quality);
                    }

                    if (dataUrl.length > IMAGE_MAX_DATA_LENGTH) {
                        reject(new Error("图片体积过大，请更换后重试"));
                        return;
                    }

                    resolve(dataUrl);
                };

                image.onerror = function () {
                    reject(new Error("图片读取失败"));
                };

                image.src = reader.result;
            };

            reader.onerror = function () {
                reject(new Error("图片读取失败"));
            };

            reader.readAsDataURL(file);
        });
    }

    function createBackend(config) {
        const backendConfig = config.backend || {};
        const mode = String(backendConfig.mode || "local-storage").toLowerCase();

        if (mode === "supabase") {
            const supabaseConfig = backendConfig.supabase || {};
            if (supabaseConfig.url && supabaseConfig.anonKey && supabaseConfig.table) {
                return createSupabaseBackend(supabaseConfig);
            }
        }

        if (mode === "local-api") {
            const localConfig = backendConfig.localApi || {};
            if (localConfig.baseUrl) {
                return createLocalApiBackend(localConfig);
            }
        }

        return createLocalStorageBackend();
    }

    function createLocalStorageBackend() {
        return {
            listCheckins: function (siteId) {
                const items = readCheckinsFromStorage();
                return Promise.resolve(items.filter(function (item) {
                    return item.siteId === siteId;
                }));
            },
            createCheckin: function (record) {
                const items = readCheckinsFromStorage();
                items.unshift(record);
                writeCheckinsToStorage(items);
                return Promise.resolve(record);
            }
        };
    }

    function createLocalApiBackend(localConfig) {
        const baseUrl = String(localConfig.baseUrl || "").replace(/\/+$/, "");

        return {
            listCheckins: async function (siteId) {
                const response = await fetch(baseUrl + "/api/checkins?siteId=" + encodeURIComponent(siteId), { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("现场记录加载失败");
                }
                const payload = await response.json();
                return (payload.items || []).map(normalizeCheckinRecord);
            },
            createCheckin: async function (record) {
                const response = await fetch(baseUrl + "/api/checkins", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        siteId: record.siteId,
                        siteName: record.siteName,
                        district: record.district,
                        visitorName: record.visitorName,
                        note: record.note,
                        photoDataUrl: record.photoUrl,
                        location: {
                            lat: record.lat,
                            lng: record.lng
                        },
                        distanceMeters: parseDistanceLabel(record.distanceLabel)
                    })
                });

                if (!response.ok) {
                    throw new Error("现场记录提交失败");
                }
            }
        };
    }

    function createSupabaseBackend(supabaseConfig) {
        const baseUrl = String(supabaseConfig.url || "").replace(/\/+$/, "");
        const anonKey = String(supabaseConfig.anonKey || "").trim();
        const table = supabaseConfig.table || "activity_checkins";

        function getHeaders(extraHeaders) {
            return Object.assign({
                apikey: anonKey,
                Authorization: "Bearer " + anonKey
            }, extraHeaders || {});
        }

        return {
            listCheckins: async function (siteId) {
                const url = new URL(baseUrl + "/rest/v1/" + encodeURIComponent(table));
                url.searchParams.set("select", "*");
                url.searchParams.set("site_id", "eq." + siteId);
                url.searchParams.set("order", "created_at.desc");

                const response = await fetch(url.toString(), {
                    headers: getHeaders()
                });
                if (!response.ok) {
                    throw new Error("现场记录加载失败");
                }
                return (await response.json()).map(normalizeCheckinRecord);
            },
            createCheckin: async function (record) {
                const response = await fetch(baseUrl + "/rest/v1/" + encodeURIComponent(table), {
                    method: "POST",
                    headers: getHeaders({
                        "Content-Type": "application/json",
                        Prefer: "return=minimal"
                    }),
                    body: JSON.stringify([{
                        id: record.id,
                        site_id: record.siteId,
                        site_name: record.siteName,
                        district: record.district,
                        visitor_name: record.visitorName,
                        note: record.note,
                        photo_url: record.photoUrl,
                        created_at: record.createdAt,
                        distance_label: record.distanceLabel,
                        lat: record.lat,
                        lng: record.lng
                    }])
                });

                if (!response.ok) {
                    throw new Error("现场记录提交失败");
                }
            }
        };
    }

    function readCheckinsFromStorage() {
        try {
            return JSON.parse(window.localStorage.getItem(CHECKIN_STORAGE_KEY) || "[]");
        } catch (error) {
            return [];
        }
    }

    function writeCheckinsToStorage(items) {
        window.localStorage.setItem(CHECKIN_STORAGE_KEY, JSON.stringify(items));
    }

    function normalizeCheckinRecord(item) {
        return {
            id: item.id || "",
            siteId: item.siteId || item.site_id || "",
            siteName: item.siteName || item.site_name || "",
            district: item.district || "",
            visitorName: item.visitorName || item.visitor_name || "",
            note: item.note || "",
            photoUrl: item.photoUrl || item.photo_url || "",
            createdAt: item.createdAt || item.created_at || "",
            distanceLabel: item.distanceLabel || item.distance_label || "",
            lat: item.lat == null ? null : Number(item.lat),
            lng: item.lng == null ? null : Number(item.lng)
        };
    }

    function parseDistanceLabel(distanceLabel) {
        if (!distanceLabel) {
            return null;
        }
        if (distanceLabel.indexOf("公里") > -1) {
            return Math.round(parseFloat(distanceLabel) * 1000);
        }
        if (distanceLabel.indexOf("米") > -1) {
            return Math.round(parseFloat(distanceLabel));
        }
        return null;
    }

    function mergeConfig(base, overrides) {
        const output = Object.assign({}, base);
        Object.keys(overrides || {}).forEach(function (key) {
            const baseValue = output[key];
            const overrideValue = overrides[key];
            if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
                output[key] = mergeConfig(baseValue, overrideValue);
                return;
            }
            output[key] = overrideValue;
        });
        return output;
    }

    function isPlainObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }

    function showToast(message) {
        elements.toast.textContent = message;
        elements.toast.classList.remove("is-hidden");
        window.clearTimeout(showToast.timer);
        showToast.timer = window.setTimeout(function () {
            elements.toast.classList.add("is-hidden");
        }, 2400);
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function escapeAttribute(value) {
        return escapeHtml(value).replace(/`/g, "&#96;");
    }

    function formatCheckinTime(value) {
        if (!value) {
            return "刚刚";
        }

        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "刚刚";
        }

        return date.getFullYear()
            + "-" + padNumber(date.getMonth() + 1)
            + "-" + padNumber(date.getDate())
            + " " + padNumber(date.getHours())
            + ":" + padNumber(date.getMinutes());
    }

    function padNumber(value) {
        return String(value).padStart(2, "0");
    }

    function generateId(prefix) {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return prefix + "_" + window.crypto.randomUUID();
        }
        return prefix + "_" + Date.now() + "_" + Math.random().toString(16).slice(2);
    }
}());
