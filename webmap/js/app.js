/**
 * SI Park Network Map — Scroll-driven storytelling
 */
(function () {
    'use strict';

    const YEARS = [2015, 2016, 2017, 2018, 2019, 2020];
    const BASELINE_YEAR = 2015;
    const SECTOR_COLORS = {
        Government: '#4A90D9', Business: '#F5A623', Civil: '#7ED321',
        Intermediate: '#9B59B6', Research: '#E74C3C',
        International: '#1ABC9C', Other: '#95A5A6',
    };
    const SECTOR_EN = {
        Government: 'Government', Business: 'Business', Civil: 'Civil Society',
        Intermediate: 'Intermediary', Research: 'Research',
        International: 'International', Other: 'Other',
    };

    let map, arcCanvas, ctx;
    let data = { nodes: [], edges: [], sectors: {} };
    let nodeMap = {};
    let currentYear = null;
    let selectedNode = null;
    let activeFilters = new Set(Object.keys(SECTOR_COLORS));

    // ===== Load Data =====
    function loadData() {
        // Load from inline script (avoids CORS issues with file:// protocol)
        data = window.__NETWORK_DATA__;
        data.nodes.forEach(n => { nodeMap[n.id] = n; n.degree = 0; });
        data.edges.forEach(e => {
            if (nodeMap[e.source]) nodeMap[e.source].degree++;
            if (nodeMap[e.target]) nodeMap[e.target].degree++;
        });

        // Pre-compute cumulative stats per year
        YEARS.forEach(y => {
            const edges = data.edges.filter(e => (e.year || BASELINE_YEAR) <= y);
            const ids = new Set();
            edges.forEach(e => { ids.add(e.source); ids.add(e.target); });
            const el = document.getElementById(`s-${y}-nodes`);
            if (el) el.textContent = ids.size;
            const el2 = document.getElementById(`s-${y}-edges`);
            if (el2) el2.textContent = edges.length;
        });
    }

    // ===== Map =====
    function initMap() {
        map = new maplibregl.Map({
            container: 'map',
            style: {
                version: 8,
                sources: {
                    'carto-dark': {
                        type: 'raster',
                        tiles: [
                            'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                            'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
                        ],
                        tileSize: 256,
                    },
                },
                layers: [{
                    id: 'carto-dark-layer',
                    type: 'raster',
                    source: 'carto-dark',
                }],
            },
            center: [127.0, 36.5],
            zoom: 6.8,
            pitch: 40,
            bearing: -5,
            interactive: true,
        });

        map.scrollZoom.disable(); // scroll controls the story, not zoom
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

        map.on('load', () => {
            addNodeLayers();
            showIntro();
        });

        map.on('error', (e) => console.warn('Map error:', e.error));
        map.on('move', drawArcs);
        map.on('moveend', drawArcs);
        map.on('pitchend', drawArcs);
        map.on('resize', () => { resizeCanvas(); drawArcs(); });

        // Click on node
        map.on('click', 'node-dots', (e) => {
            const f = e.features[0];
            if (f) selectNode(nodeMap[f.properties.id]);
        });
        map.on('click', (e) => {
            const ft = map.queryRenderedFeatures(e.point, { layers: ['node-dots'] });
            if (ft.length === 0) clearSelection();
        });

        // Hover
        map.on('mouseenter', 'node-dots', (e) => {
            map.getCanvas().style.cursor = 'pointer';
            showTooltip(e.point, e.features[0].properties);
        });
        map.on('mousemove', 'node-dots', (e) => {
            showTooltip(e.point, e.features[0].properties);
        });
        map.on('mouseleave', 'node-dots', () => {
            map.getCanvas().style.cursor = '';
            hideTooltip();
        });
    }

    function addNodeLayers() {
        map.addSource('nodes', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });

        // Glow
        map.addLayer({
            id: 'node-glow',
            type: 'circle',
            source: 'nodes',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'degree'],
                    0, 5, 5, 9, 20, 16, 50, 24],
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.12,
                'circle-blur': 1,
            },
        });

        // Dots
        map.addLayer({
            id: 'node-dots',
            type: 'circle',
            source: 'nodes',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['get', 'degree'],
                    0, 1.8, 5, 3, 20, 5.5, 50, 8],
                'circle-color': ['get', 'color'],
                'circle-opacity': 0.85,
                'circle-stroke-width': 0.4,
                'circle-stroke-color': 'rgba(255,255,255,0.15)',
            },
        });
    }

    // ===== Intro (single point at SI Park) =====
    const SI_PARK = [126.9290, 37.6117];

    function showIntro() {
        currentYear = null;
        document.getElementById('year-indicator').classList.add('hidden');
        document.getElementById('fixed-top-right').classList.remove('visible');

        const features = [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: SI_PARK },
            properties: {
                id: 'si-park',
                sector: 'Civil',
                color: '#7ED321',
                degree: 114,
            },
        }];

        const src = map.getSource('nodes');
        if (src) src.setData({ type: 'FeatureCollection', features });
        drawArcs();
    }

    // ===== Year Control =====
    function setYear(year) {
        if (currentYear === year) return;
        currentYear = year;

        // Update indicator
        const ind = document.getElementById('year-indicator');
        ind.textContent = '~' + year;
        ind.classList.remove('hidden');
        document.getElementById('fixed-top-right').classList.add('visible');

        // Update nodes
        const visibleEdges = getVisibleEdges();
        const visibleIds = new Set();
        visibleEdges.forEach(e => { visibleIds.add(e.source); visibleIds.add(e.target); });

        // Also always include resident orgs
        data.nodes.forEach(n => { if (n.type === '입주조직') visibleIds.add(n.id); });

        const features = data.nodes
            .filter(n => visibleIds.has(n.id) && activeFilters.has(n.sector))
            .map(n => ({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
                properties: { id: n.id, sector: n.sector, color: n.color, degree: n.degree },
            }));

        const src = map.getSource('nodes');
        if (src) src.setData({ type: 'FeatureCollection', features });

        drawArcs();
    }

    function getVisibleEdges() {
        if (currentYear === null) return [];
        return data.edges.filter(e => (e.year || BASELINE_YEAR) <= currentYear);
    }

    // ===== Arc Drawing =====
    function resizeCanvas() {
        arcCanvas = document.getElementById('arc-canvas');
        const dpr = window.devicePixelRatio || 1;
        arcCanvas.width = window.innerWidth * dpr;
        arcCanvas.height = window.innerHeight * dpr;
        arcCanvas.style.width = window.innerWidth + 'px';
        arcCanvas.style.height = window.innerHeight + 'px';
        ctx = arcCanvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    function drawArcs() {
        if (!ctx || !map) return;
        const w = window.innerWidth, h = window.innerHeight;
        ctx.clearRect(0, 0, w, h);

        const visibleEdges = getVisibleEdges();
        const egoEdges = selectedNode ? getEgoEdges(selectedNode) : null;

        for (const edge of visibleEdges) {
            const sn = nodeMap[edge.source], tn = nodeMap[edge.target];
            if (!sn || !tn) continue;
            if (!activeFilters.has(sn.sector) && !activeFilters.has(tn.sector)) continue;

            const p1 = map.project([sn.lng, sn.lat]);
            const p2 = map.project([tn.lng, tn.lat]);

            if ((p1.x < -50 && p2.x < -50) || (p1.x > w + 50 && p2.x > w + 50)) continue;
            if ((p1.y < -50 && p2.y < -50) || (p1.y > h + 50 && p2.y > h + 50)) continue;

            const isEgo = egoEdges && egoEdges.has(edge);
            const isDim = egoEdges && !isEgo;

            const color = sn.color || '#95A5A6';
            const alpha = isDim ? 0.01 : (isEgo ? 0.55 : 0.1);
            const lw = isDim ? 0.2 : (isEgo ? 1.8 : 0.4);

            drawArc(p1, p2, color, alpha, lw);
        }
    }

    function drawArc(p1, p2, color, alpha, lw) {
        const dx = p2.x - p1.x, dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2 - Math.min(dist * 0.3, 120);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(mx, my, p2.x, p2.y);

        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = lw;
        ctx.stroke();
    }

    function getEgoEdges(node) {
        const s = new Set();
        getVisibleEdges().forEach(e => {
            if (e.source === node.id || e.target === node.id) s.add(e);
        });
        return s;
    }

    // ===== Tooltip =====
    function showTooltip(pt, props) {
        const tt = document.getElementById('tooltip');
        tt.innerHTML = `<div class="tt-name">${nodeMap[props.id]?.name || props.id}</div>
            <div class="tt-sub">${SECTOR_EN[props.sector] || ''} · ${props.degree} connections</div>`;
        tt.style.display = 'block';
        tt.style.left = (pt.x + 14) + 'px';
        tt.style.top = (pt.y - 8) + 'px';
    }

    function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }

    // ===== Selection =====
    function selectNode(node) {
        if (!node) return;
        if (selectedNode === node) { clearSelection(); return; }
        selectedNode = node;
        showNodeInfo(node);
        drawArcs();
    }

    function clearSelection() {
        selectedNode = null;
        document.getElementById('node-info').classList.add('hidden');
        drawArcs();
    }

    function showNodeInfo(node) {
        const panel = document.getElementById('node-info');
        panel.classList.remove('hidden');
        document.getElementById('info-name').textContent = node.name;

        document.getElementById('info-meta').innerHTML = `
            <span class="info-badge" style="background:${node.color}33;color:${node.color}">
                ${SECTOR_EN[node.sector] || node.sector}
            </span>
            <div class="info-stat">${node.type === '입주조직' ? 'Resident' : 'Partner'} · ${node.degree} connections</div>`;

        const partners = [];
        getVisibleEdges().forEach(e => {
            if (e.source === node.id && nodeMap[e.target])
                partners.push({ node: nodeMap[e.target], year: e.year });
            else if (e.target === node.id && nodeMap[e.source])
                partners.push({ node: nodeMap[e.source], year: e.year });
        });
        partners.sort((a, b) => (a.year || 0) - (b.year || 0));

        document.getElementById('info-partners').innerHTML = `
            <div class="info-section-title">Partners (${partners.length})</div>
            <ul class="partner-list">${partners.map(p =>
                `<li data-id="${p.node.id}"><span>${p.node.name}</span><span class="p-year">${p.year || ''}</span></li>`
            ).join('')}</ul>`;

        document.getElementById('info-partners').querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => selectNode(nodeMap[li.dataset.id]));
        });
    }

    // ===== Scroll Observer =====
    function initScroll() {
        const sections = document.querySelectorAll('.scroll-section');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const section = entry.target;
                if (entry.isIntersecting) {
                    section.classList.add('active');
                    const year = section.dataset.year;
                    if (year === 'none' && map.loaded()) {
                        showIntro();
                    } else if (year && map.loaded()) {
                        setYear(parseInt(year));
                    }
                } else {
                    section.classList.remove('active');
                }
            });
        }, {
            threshold: 0.5,
        });

        sections.forEach(s => observer.observe(s));
    }

    // ===== Legend =====
    function initLegend() {
        const container = document.getElementById('legend-items');
        Object.entries(SECTOR_COLORS).forEach(([sector, color]) => {
            const count = data.nodes.filter(n => n.sector === sector).length;
            if (count === 0) return;
            const item = document.createElement('div');
            item.className = 'legend-item';
            item.innerHTML = `<span class="legend-dot" style="background:${color}"></span>
                <span>${SECTOR_EN[sector]}</span>
                <span class="legend-count">${count}</span>`;
            item.addEventListener('click', () => {
                if (activeFilters.has(sector)) { activeFilters.delete(sector); item.classList.add('dimmed'); }
                else { activeFilters.add(sector); item.classList.remove('dimmed'); }
                setYear(currentYear); // refresh
            });
            container.appendChild(item);
        });
    }

    // ===== Init =====
    function init() {
        loadData();
        resizeCanvas();
        initMap();
        initScroll();
        initLegend();
        document.getElementById('info-close').addEventListener('click', clearSelection);
        window.addEventListener('resize', () => { resizeCanvas(); drawArcs(); });
    }

    init();
})();
