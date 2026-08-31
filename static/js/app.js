/**
 * System Performance Monitor - Dashboard Client Logic
 * Features:
 * - Fixed Sidebar Navigation (3 Tabs: Overview, Disk Breakdown, Notifications & Events)
 * - Real-time Telemetry & 60s Bezier Charts (WebSocket)
 * - Disk Space Directory Breakdown
 * - Full-Page Notifications & Events Hub (Dual Column)
 * - 2-Way 1:1 Real-time Windows Action Center Synchronization
 * - Persistent LocalStorage Unread Badge Management
 */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // LocalStorage Helper for Read Notification IDs
    // =========================================================================
    const STORAGE_KEY_READ_IDS = 'spm_read_notification_ids';

    function getStoredReadIds() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_READ_IDS);
            if (!raw) return new Set();
            const parsed = JSON.parse(raw);
            return new Set(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
            return new Set();
        }
    }

    function saveStoredReadId(id) {
        try {
            const current = getStoredReadIds();
            current.add(id);
            const arr = Array.from(current).slice(-1000);
            localStorage.setItem(STORAGE_KEY_READ_IDS, JSON.stringify(arr));
        } catch (e) {
            console.error('Error saving read ID to localStorage:', e);
        }
    }

    function saveAllStoredReadIds(ids) {
        try {
            const current = getStoredReadIds();
            ids.forEach(id => current.add(id));
            const arr = Array.from(current).slice(-1000);
            localStorage.setItem(STORAGE_KEY_READ_IDS, JSON.stringify(arr));
        } catch (e) {
            console.error('Error saving all read IDs to localStorage:', e);
        }
    }

    // Automatic backend API & WebSocket origin resolver (supports both http://localhost:8000 and file:// protocol)
    const API_BASE = (window.location.protocol === 'file:' || !window.location.host) 
        ? 'http://127.0.0.1:8000' 
        : '';
    const WS_BASE = (window.location.protocol === 'file:' || !window.location.host)
        ? 'ws://127.0.0.1:8000'
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

    // Intercept window.fetch to automatically resolve relative /api routes if opened via file://
    const _originalFetch = window.fetch;
    window.fetch = function (resource, init) {
        if (typeof resource === 'string' && resource.startsWith('/api') && API_BASE) {
            resource = `${API_BASE}${resource}`;
        }
        return _originalFetch.call(this, resource, init);
    };

    // =========================================================================
    // Application State
    // =========================================================================
    const state = {
        // Theme state: 'dark' or 'light'
        currentTheme: localStorage.getItem('dashboard_theme') || 'dark',

        // Tab routing: 'overview', 'disk', 'notifications'
        activeTab: 'overview',

        // Realtime Monitor state
        isPaused: false,
        socket: null,
        reconnectTimer: null,
        procSortMode: 'cpu', // 'cpu' or 'ram'
        procSearchQuery: '',
        lastMetrics: null,
        maxHistoryPoints: 60,
        chartData: {
            labels: [],
            cpuHistory: [],
            ramHistory: []
        },

        // Disk Analysis state
        selectedDrive: 'C:',
        availableDrives: ['C:', 'D:'],
        diskBreakdownData: null,
        diskSearchQuery: '',
        isDiskScanning: false,
        subfolderCache: new Map(),
        expandedFolders: new Set(),

        // App Analytics state
        appTimeRange: 'today',
        appSearchQuery: '',
        appSortKey: 'total_bytes',
        appSortOrder: 'desc',
        appAnalyticsData: null,
        appCache: new Map(),

        // Downloads Tracker state
        downloadsFilter: 'today', // 'today', 'week', 'month', 'all'
        downloadsSearchQuery: '',
        downloadsTypeFilter: 'all',
        downloadsData: null,
        isDownloadsScanning: false,

        // Alerts & Webhooks state
        alertConfig: null,
        alertHistory: [],
        alertActiveSubTab: 'settings', // 'settings' or 'logs'
        alertLogsSearchQuery: '',
        alertLogsTypeFilter: 'all', // 'all', 'CPU', 'RAM', 'DISK', 'TEST'
        alertLogsChannelFilter: 'all', // 'all', 'discord', 'telegram'
        isTestingAlert: false,
        isSavingAlert: false,

        // Notifications Hub state
        hubSearchQuery: '',
        hubFilter: 'all', // 'all', 'toasts', 'Error', 'Warning', 'Info'
        toastNotifications: [],
        lastToastIdsHash: '',
        eventLogNotifications: [],
        totalUnreadCount: 0,
        toastUnreadCount: 0,
        eventLogUnreadCount: 0,
        notifPollTimer: null,
    };

    // =========================================================================
    // DOM Elements Cache
    // =========================================================================
    const elements = {
        // Sidebar Navigation & Widgets
        sidebarSubHostname: document.getElementById('sidebar-sub-hostname'),
        navItemOverview: document.getElementById('nav-item-overview'),
        navItemDisk: document.getElementById('nav-item-disk'),
        navItemApps: document.getElementById('nav-item-apps'),
        navItemDownloads: document.getElementById('nav-item-downloads'),
        navItemNotif: document.getElementById('nav-item-notif'),
        navItemAlerts: document.getElementById('nav-item-alerts'),
        navItemFocus: document.getElementById('nav-item-focus'),
        navItemRadar: document.getElementById('nav-item-radar'),
        navItemPower: document.getElementById('nav-item-power'),
        navItemWallpaper: document.getElementById('nav-item-wallpaper'),
        navItemLab: document.getElementById('nav-item-lab'),
        navItemVocab: document.getElementById('nav-item-vocab'),
        sidebarNotifBadge: document.getElementById('sidebar-notif-badge'),
        sidebarOsText: document.getElementById('sidebar-os-text'),
        sidebarUptime: document.getElementById('sidebar-uptime'),
        sidebarNetStatusPill: document.getElementById('sidebar-net-status-pill'),
        sidebarPingVal: document.getElementById('sidebar-ping-val'),
        sidebarLocalIp: document.getElementById('sidebar-local-ip'),
        btnActionFlushDns: document.getElementById('btn-action-flush-dns'),
        btnActionCleanTemp: document.getElementById('btn-action-clean-temp'),
        sidebarCyberPetWidget: document.getElementById('sidebar-cyber-pet-widget'),
        iconFlushDns: document.getElementById('icon-flush-dns'),
        iconCleanTemp: document.getElementById('icon-clean-temp'),
        actionToastContainer: document.getElementById('action-toast-container'),

        // Header & Controls
        headerViewTitle: document.getElementById('header-view-title'),
        systemSubtitle: document.getElementById('system-subtitle'),
        systemSubtitleChip: document.getElementById('system-subtitle-chip'),
        headCpuVal: document.getElementById('head-cpu-val'),
        headRamVal: document.getElementById('head-ram-val'),
        headUptimeVal: document.getElementById('head-uptime-val'),
        wsStatus: document.getElementById('ws-status'),
        btnPauseStream: document.getElementById('btn-pause-stream'),
        textPauseBtn: document.getElementById('text-pause-btn'),
        iconPause: document.getElementById('icon-pause'),
        iconPlay: document.getElementById('icon-play'),
        btnManualRefresh: document.getElementById('btn-manual-refresh'),
        btnThemeToggle: document.getElementById('btn-theme-toggle'),
        iconThemeSun: document.getElementById('icon-theme-sun'),
        iconThemeMoon: document.getElementById('icon-theme-moon'),

        // Header AI Copilot Flyout Elements
        aiFlyoutWrapper: document.getElementById('ai-flyout-wrapper'),
        btnHeaderAiCopilot: document.getElementById('btn-header-ai-copilot'),
        aiCopilotFlyout: document.getElementById('ai-copilot-flyout'),
        flyoutBotTitle: document.getElementById('flyout-bot-title'),
        btnFlyoutGeminiSettings: document.getElementById('btn-flyout-gemini-settings'),
        btnFlyoutExpandChat: document.getElementById('btn-flyout-expand-chat'),
        btnCloseAiFlyout: document.getElementById('btn-close-ai-flyout'),
        flyoutHealthBadge: document.getElementById('flyout-health-badge'),
        flyoutScoreText: document.getElementById('flyout-score-text'),
        flyoutInsightText: document.getElementById('flyout-insight-text'),
        flyoutMessagesContainer: document.getElementById('flyout-messages-container'),
        flyoutQuickChips: document.getElementById('flyout-quick-chips'),
        flyoutPromptInput: document.getElementById('flyout-prompt-input'),
        btnFlyoutSend: document.getElementById('btn-flyout-send'),

        // Header Quick Notification Dropdown Elements
        notifFlyoutWrapper: document.getElementById('notif-flyout-wrapper'),
        btnNotificationBell: document.getElementById('btn-notification-bell'),
        notifBadgeCount: document.getElementById('notif-badge-count'),
        notifOverviewDropdown: document.getElementById('notif-overview-dropdown'),
        dropdownUnreadPill: document.getElementById('dropdown-unread-pill'),
        btnDropdownMarkAll: document.getElementById('btn-dropdown-mark-all'),
        btnCloseNotifDropdown: document.getElementById('btn-close-notif-dropdown'),
        notifDropdownList: document.getElementById('notif-dropdown-list'),
        btnDropdownViewHub: document.getElementById('btn-dropdown-view-hub'),

        // Tab Views
        viewOverview: document.getElementById('view-overview'),
        viewDiskAnalysis: document.getElementById('view-disk-analysis'),
        viewAppsAnalysis: document.getElementById('view-apps-analysis'),
        viewDownloadsTracker: document.getElementById('view-downloads-tracker'),
        viewNotificationsHub: document.getElementById('view-notifications-hub'),
        viewAlertsSettings: document.getElementById('view-alerts-settings'),
        viewFocusDeck: document.getElementById('view-focus-deck'),
        viewNetworkRadar: document.getElementById('view-network-radar'),
        viewPowerEstimator: document.getElementById('view-power-estimator'),
        viewWallpaperStudio: document.getElementById('view-wallpaper-studio'),
        viewSnippetLab: document.getElementById('view-snippet-lab'),
        viewVocabBooster: document.getElementById('view-vocab-booster'),

        // Tab 4: App Analytics Elements
        appKpiTodayNet: document.getElementById('app-kpi-today-net'),
        appKpiTodayDlUl: document.getElementById('app-kpi-today-dl-ul'),
        appKpiWeekNet: document.getElementById('app-kpi-week-net'),
        appKpiMonthNet: document.getElementById('app-kpi-month-net'),
        appKpiTodaySt: document.getElementById('app-kpi-today-st'),
        appAnalyticsTbody: document.getElementById('app-analytics-tbody'),
        appTableTotalCount: document.getElementById('app-table-total-count'),
        appSearchInput: document.getElementById('app-search-input'),
        btnClearAppSearch: document.getElementById('btn-clear-app-search'),
        appInsightsSummary: document.getElementById('app-insights-summary'),
        appInsightsPills: document.getElementById('app-insights-pills'),

        // Tab 1: 4 Stat Cards
        cpuPercent: document.getElementById('cpu-percent'),
        cpuProgressBar: document.getElementById('cpu-progress-bar'),
        cpuStatusTag: document.getElementById('cpu-status-tag'),
        cpuFreqText: document.getElementById('cpu-freq-text'),
        cpuCoresText: document.getElementById('cpu-cores-text'),

        ramPercent: document.getElementById('ram-percent'),
        ramProgressBar: document.getElementById('ram-progress-bar'),
        ramStatusTag: document.getElementById('ram-status-tag'),
        ramUsedTotal: document.getElementById('ram-used-total'),
        ramFree: document.getElementById('ram-free'),

        diskPercent: document.getElementById('disk-percent'),
        diskProgressBar: document.getElementById('disk-progress-bar'),
        diskDrivesCount: document.getElementById('disk-drives-count'),
        diskUsedTotal: document.getElementById('disk-used-total'),
        diskFree: document.getElementById('disk-free'),

        netDownSpeed: document.getElementById('net-down-speed'),
        netUpSpeed: document.getElementById('net-up-speed'),
        netTotalRecv: document.getElementById('net-total-recv'),
        netTotalSent: document.getElementById('net-total-sent'),

        // Tab 1: Panels
        diskIoRate: document.getElementById('disk-io-rate'),
        drivesList: document.getElementById('drives-list'),
        coresGrid: document.getElementById('cores-grid'),
        cpuSummaryBadge: document.getElementById('cpu-summary-badge'),

        // Tab 1: AI Copilot & Insights
        copilotPanelTitle: document.getElementById('copilot-panel-title'),
        btnExpandGeminiChat: document.getElementById('btn-expand-gemini-chat'),
        btnExpandFromBubble: document.getElementById('btn-expand-from-bubble'),
        btnOpenGeminiModal: document.getElementById('btn-open-gemini-modal'),
        geminiSettingsModal: document.getElementById('gemini-settings-modal'),
        btnCloseGeminiModal: document.getElementById('btn-close-gemini-modal'),
        btnCancelGeminiModal: document.getElementById('btn-cancel-gemini-modal'),
        geminiApiKeyInput: document.getElementById('gemini-api-key-input'),
        btnToggleKeyVisibility: document.getElementById('btn-toggle-key-visibility'),
        geminiModelSelect: document.getElementById('gemini-model-select'),
        geminiModalStatus: document.getElementById('gemini-modal-status'),
        btnSaveGeminiConfig: document.getElementById('btn-save-gemini-config'),
        geminiSaveText: document.getElementById('gemini-save-text'),
        btnClearGeminiKey: document.getElementById('btn-clear-gemini-key'),

        // Expanded Gemini Chat Modal
        geminiChatExpandedModal: document.getElementById('gemini-chat-expanded-modal'),
        btnCloseExpandedChat: document.getElementById('btn-close-expanded-chat'),
        btnClearChatHistory: document.getElementById('btn-clear-chat-history'),
        expandedMessagesContainer: document.getElementById('expanded-messages-container'),
        expandedPromptInput: document.getElementById('expanded-prompt-input'),
        btnExpandedSend: document.getElementById('btn-expanded-send'),
        chatTelCpu: document.getElementById('chat-tel-cpu'),
        chatTelRam: document.getElementById('chat-tel-ram'),
        chatTelDisk: document.getElementById('chat-tel-disk'),
        chatTelNet: document.getElementById('chat-tel-net'),
        chatTelHealth: document.getElementById('chat-tel-health'),

        copilotHealthBadge: document.getElementById('copilot-health-badge'),
        copilotScoreText: document.getElementById('copilot-score-text'),
        copilotInsightsBox: document.getElementById('copilot-insights-box'),
        copilotInsightText: document.getElementById('copilot-insight-text'),
        copilotSuggestionsContainer: document.getElementById('copilot-suggestions-container'),
        copilotChatResponse: document.getElementById('copilot-chat-response'),
        copilotChatContent: document.getElementById('copilot-chat-content'),
        copilotQuickChips: document.getElementById('copilot-quick-chips'),
        btnCloseCopilotChat: document.getElementById('btn-close-copilot-chat'),
        copilotPromptInput: document.getElementById('copilot-prompt-input'),
        btnCopilotSend: document.getElementById('btn-copilot-send'),
        iconCopilotSend: document.getElementById('icon-copilot-send'),

        // Tab 1: Processes Table
        tabSortCpu: document.getElementById('tab-sort-cpu'),
        tabSortRam: document.getElementById('tab-sort-ram'),
        procSearchInput: document.getElementById('proc-search-input'),
        totalProcCount: document.getElementById('total-proc-count'),
        processesTbody: document.getElementById('processes-tbody'),

        // Tab 2: Disk Breakdown Controls
        diskDriveSelectors: document.getElementById('disk-drive-selectors'),
        diskScanStatus: document.getElementById('disk-scan-status'),
        btnScanDisk: document.getElementById('btn-scan-disk'),
        diskSpinIcon: document.getElementById('disk-spin-icon'),
        diskBtnText: document.getElementById('disk-btn-text'),
        diskSearchInput: document.getElementById('disk-search-input'),

        // Tab 2: Stat Cards
        diskAnalyzedDriveName: document.getElementById('disk-analyzed-drive-name'),
        diskCardTotal: document.getElementById('disk-card-total'),
        diskCardBar: document.getElementById('disk-card-bar'),
        diskCardUsed: document.getElementById('disk-card-used'),
        diskCardPercentUsed: document.getElementById('disk-card-percent-used'),

        diskCardAnalyzed: document.getElementById('disk-card-analyzed'),
        diskCardAnalyzedBar: document.getElementById('disk-card-analyzed-bar'),
        diskCardAnalyzedPct: document.getElementById('disk-card-analyzed-pct'),
        diskCardItemsCount: document.getElementById('disk-card-items-count'),

        diskCardFree: document.getElementById('disk-card-free'),
        diskCardFreeBar: document.getElementById('disk-card-free-bar'),
        diskCardFreePct: document.getElementById('disk-card-free-pct'),
        diskFreeTag: document.getElementById('disk-free-tag'),

        diskCardDuration: document.getElementById('disk-card-duration'),
        diskCardLastScan: document.getElementById('disk-card-last-scan'),
        diskCardCacheInfo: document.getElementById('disk-card-cache-info'),
        diskCacheTag: document.getElementById('disk-cache-tag'),

        // Tab 2: Table
        diskTableTotalCount: document.getElementById('disk-table-total-count'),
        diskBreakdownTbody: document.getElementById('disk-breakdown-tbody'),

        // Tab 3: Dedicated Notifications & Events Hub
        hubCountToasts: document.getElementById('hub-count-toasts'),
        hubCountEvents: document.getElementById('hub-count-events'),
        hubCountUnread: document.getElementById('hub-count-unread'),
        btnHubMarkAll: document.getElementById('btn-hub-mark-all'),
        btnHubRefresh: document.getElementById('btn-hub-refresh'),
        hubRefreshIcon: document.getElementById('hub-refresh-icon'),
        hubSearchInput: document.getElementById('hub-search-input'),
        hubToastsBadge: document.getElementById('hub-toasts-badge'),
        hubEventsBadge: document.getElementById('hub-events-badge'),
        hubToastsContainer: document.getElementById('hub-toasts-container'),
        hubEventsContainer: document.getElementById('hubEventsContainer') || document.getElementById('hub-events-container'),

        // Tab 5: Downloads Tracker Elements
        dlTimeFilters: document.getElementById('dl-time-filters'),
        dlSearchInput: document.getElementById('dl-search-input'),
        btnClearDlSearch: document.getElementById('btn-clear-dl-search'),
        dlTypeFilter: document.getElementById('dl-type-filter'),
        btnOpenDownloadsDir: document.getElementById('btn-open-downloads-dir'),
        btnRefreshDownloads: document.getElementById('btn-refresh-downloads'),
        dlSpinIcon: document.getElementById('dl-spin-icon'),
        dlKpiFilterTag: document.getElementById('dl-kpi-filter-tag'),
        dlKpiTotalFiles: document.getElementById('dl-kpi-total-files'),
        dlKpiDirText: document.getElementById('dl-kpi-dir-text'),
        dlKpiScanTime: document.getElementById('dl-kpi-scan-time'),
        dlKpiSizeTag: document.getElementById('dl-kpi-size-tag'),
        dlKpiTotalSize: document.getElementById('dl-kpi-total-size'),
        dlKpiAvgSize: document.getElementById('dl-kpi-avg-size'),
        dlKpiCacheStatus: document.getElementById('dl-kpi-cache-status'),
        dlKpiTopCategoryBadge: document.getElementById('dl-kpi-top-category-badge'),
        dlKpiTopCategoryName: document.getElementById('dl-kpi-top-category-name'),
        dlKpiTopCategoryMeta: document.getElementById('dl-kpi-top-category-meta'),
        dlKpiTopCategoryPct: document.getElementById('dl-kpi-top-category-pct'),
        dlActiveFilterLabel: document.getElementById('dl-active-filter-label'),
        dlCategoryBarTrack: document.getElementById('dl-category-bar-track'),
        dlCategoryLegend: document.getElementById('dl-category-legend'),
        dlTableCountBadge: document.getElementById('dl-table-count-badge'),
        downloadsTbody: document.getElementById('downloads-tbody'),

        // Tab 6: Alerts & Webhooks Elements
        subnavAlertSettings: document.getElementById('subnav-alert-settings'),
        subnavAlertLogs: document.getElementById('subnav-alert-logs'),
        subnavAlertLogsBadge: document.getElementById('subnav-alert-logs-badge'),
        alertSubviewSettings: document.getElementById('alert-subview-settings'),
        alertSubviewLogs: document.getElementById('alert-subview-logs'),
        alertEngineStatusPill: document.getElementById('alert-engine-status-pill'),
        alertEngineStatusText: document.getElementById('alert-engine-status-text'),
        alertBadgeCooldownMin: document.getElementById('alert-badge-cooldown-min'),
        alertMasterToggle: document.getElementById('alert-master-toggle'),
        btnTestAlert: document.getElementById('btn-test-alert'),
        iconTestAlert: document.getElementById('icon-test-alert'),
        textTestAlert: document.getElementById('text-test-alert'),
        btnSaveAlertConfig: document.getElementById('btn-save-alert-config'),
        btnRefreshAlertLogs: document.getElementById('btn-refresh-alert-logs'),
        iconRefreshAlertLogs: document.getElementById('icon-refresh-alert-logs'),
        btnClearAlertLogs: document.getElementById('btn-clear-alert-logs'),
        alertLogsSearchInput: document.getElementById('alert-logs-search-input'),
        btnClearAlertSearch: document.getElementById('btn-clear-alert-search'),
        alertTypeFilters: document.getElementById('alert-type-filters'),
        alertChannelFilters: document.getElementById('alert-channel-filters'),

        // Logs KPI Elements
        logKpiTotalCount: document.getElementById('log-kpi-total-count'),
        logKpiLastSent: document.getElementById('log-kpi-last-sent'),
        logKpiCooldownText: document.getElementById('log-kpi-cooldown-text'),
        logKpiCriticalBadge: document.getElementById('log-kpi-critical-badge'),
        logKpiCriticalCount: document.getElementById('log-kpi-critical-count'),
        logKpiWarnCount: document.getElementById('log-kpi-warn-count'),
        logKpiTestCount: document.getElementById('log-kpi-test-count'),
        logKpiDeliveryPctBadge: document.getElementById('log-kpi-delivery-pct-badge'),
        logKpiDeliverySuccessRate: document.getElementById('log-kpi-delivery-success-rate'),
        logKpiDiscordDelivered: document.getElementById('log-kpi-discord-delivered'),
        logKpiTgDelivered: document.getElementById('log-kpi-tg-delivered'),
        logKpiTopResourceBadge: document.getElementById('log-kpi-top-resource-badge'),
        logKpiTopResourceName: document.getElementById('log-kpi-top-resource-name'),
        logKpiTopResourcePeak: document.getElementById('log-kpi-top-resource-peak'),
        logKpiTopResourcePct: document.getElementById('log-kpi-top-resource-pct'),

        // Pill Count Tags
        pillCountAll: document.getElementById('pill-count-all'),
        pillCountCpu: document.getElementById('pill-count-cpu'),
        pillCountRam: document.getElementById('pill-count-ram'),
        pillCountDisk: document.getElementById('pill-count-disk'),
        pillCountTest: document.getElementById('pill-count-test'),

        // Live Meters
        meterCurrCpu: document.getElementById('meter-curr-cpu'),
        meterLimitCpu: document.getElementById('meter-limit-cpu'),
        meterBarCpu: document.getElementById('meter-bar-cpu'),
        meterMarkerCpu: document.getElementById('meter-marker-cpu'),
        meterBadgeCpu: document.getElementById('meter-badge-cpu'),

        meterCurrRam: document.getElementById('meter-curr-ram'),
        meterLimitRam: document.getElementById('meter-limit-ram'),
        meterBarRam: document.getElementById('meter-bar-ram'),
        meterMarkerRam: document.getElementById('meter-marker-ram'),
        meterBadgeRam: document.getElementById('meter-badge-ram'),

        meterCurrDisk: document.getElementById('meter-curr-disk'),
        meterLimitDisk: document.getElementById('meter-limit-disk'),
        meterBarDisk: document.getElementById('meter-bar-disk'),
        meterMarkerDisk: document.getElementById('meter-marker-disk'),
        meterBadgeDisk: document.getElementById('meter-badge-disk'),

        // Form inputs
        alertDiscordEnable: document.getElementById('alert-discord-enable'),
        alertDiscordUrl: document.getElementById('alert-discord-url'),
        btnToggleDiscordMask: document.getElementById('btn-toggle-discord-mask'),
        alertTelegramEnable: document.getElementById('alert-telegram-enable'),
        alertTelegramToken: document.getElementById('alert-telegram-token'),
        alertTelegramChatId: document.getElementById('alert-telegram-chat-id'),
        btnToggleTgMask: document.getElementById('btn-toggle-tg-mask'),
        alertCpuEnable: document.getElementById('alert-cpu-enable'),
        alertCpuInput: document.getElementById('alert-cpu-input'),
        alertCpuSlider: document.getElementById('alert-cpu-slider'),
        alertCpuSustained: document.getElementById('alert-cpu-sustained'),
        alertRamEnable: document.getElementById('alert-ram-enable'),
        alertRamInput: document.getElementById('alert-ram-input'),
        alertRamSlider: document.getElementById('alert-ram-slider'),
        alertDiskEnable: document.getElementById('alert-disk-enable'),
        alertDiskInput: document.getElementById('alert-disk-input'),
        alertDiskSlider: document.getElementById('alert-disk-slider'),
        alertCooldownInput: document.getElementById('alert-cooldown-input'),
        alertHistoryCountBadge: document.getElementById('alert-history-count-badge'),
        alertsHistoryTbody: document.getElementById('alerts-history-tbody'),

        // Footer
        footerSyncTime: document.getElementById('footer-sync-time'),
    };

    // =========================================================================
    // Dark / Light Theme Management System
    // =========================================================================
    const STORAGE_KEY_THEME = 'dashboard_theme';

    function initTheme() {
        const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || 'dark';
        applyTheme(savedTheme, false);
    }

    function applyTheme(theme, updateCharts = true) {
        state.currentTheme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        try {
            localStorage.setItem(STORAGE_KEY_THEME, theme);
        } catch (e) {}

        const isLight = theme === 'light';
        if (elements.iconThemeSun && elements.iconThemeMoon) {
            elements.iconThemeSun.classList.toggle('hidden', isLight);
            elements.iconThemeMoon.classList.toggle('hidden', !isLight);
        }

        if (elements.btnThemeToggle) {
            elements.btnThemeToggle.title = isLight 
                ? 'Chuyển sang giao diện Tối (Dark Mode)' 
                : 'Chuyển sang giao diện Sáng (Light Mode)';
        }

        if (updateCharts) {
            updateChartsTheme(isLight);
        }
    }

    function toggleTheme() {
        const nextTheme = state.currentTheme === 'light' ? 'dark' : 'light';
        applyTheme(nextTheme, true);
    }

    function updateChartsTheme(isLight) {
        const gridColor = isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(255, 255, 255, 0.04)';
        const tickColor = isLight ? '#64748b' : '#64748b';
        const tooltipBg = isLight ? '#ffffff' : 'rgba(20, 24, 30, 0.96)';
        const tooltipTitle = isLight ? '#1e293b' : '#ffffff';
        const tooltipBody = isLight ? '#475569' : '#f1f5f9';
        const tooltipBorder = isLight ? 'rgba(5, 150, 105, 0.3)' : 'rgba(194, 248, 59, 0.35)';

        // 1. Realtime Metrics Chart
        if (metricsChart) {
            if (metricsChart.options.scales.x) {
                metricsChart.options.scales.x.grid.color = gridColor;
                metricsChart.options.scales.x.ticks.color = tickColor;
            }
            if (metricsChart.options.scales.y) {
                metricsChart.options.scales.y.grid.color = gridColor;
                metricsChart.options.scales.y.ticks.color = tickColor;
            }
            if (metricsChart.options.plugins.tooltip) {
                metricsChart.options.plugins.tooltip.backgroundColor = tooltipBg;
                metricsChart.options.plugins.tooltip.titleColor = tooltipTitle;
                metricsChart.options.plugins.tooltip.bodyColor = tooltipBody;
                metricsChart.options.plugins.tooltip.borderColor = tooltipBorder;
            }
            metricsChart.update('none');
        }

        // 2. Disk Donut Chart
        if (diskDonutChart) {
            if (diskDonutChart.options.plugins.legend) {
                diskDonutChart.options.plugins.legend.labels.color = isLight ? '#475569' : '#94a3b8';
            }
            if (diskDonutChart.options.plugins.tooltip) {
                diskDonutChart.options.plugins.tooltip.backgroundColor = tooltipBg;
                diskDonutChart.options.plugins.tooltip.titleColor = tooltipTitle;
                diskDonutChart.options.plugins.tooltip.bodyColor = tooltipBody;
                diskDonutChart.options.plugins.tooltip.borderColor = tooltipBorder;
            }
            diskDonutChart.update('none');
        }

        // 3. Disk Bar Chart
        if (diskBarChart) {
            if (diskBarChart.options.scales.x) {
                diskBarChart.options.scales.x.grid.color = gridColor;
                diskBarChart.options.scales.x.ticks.color = tickColor;
            }
            if (diskBarChart.options.scales.y) {
                diskBarChart.options.scales.y.ticks.color = isLight ? '#0f172a' : '#f1f5f9';
            }
            if (diskBarChart.options.plugins.tooltip) {
                diskBarChart.options.plugins.tooltip.backgroundColor = tooltipBg;
                diskBarChart.options.plugins.tooltip.titleColor = tooltipTitle;
                diskBarChart.options.plugins.tooltip.bodyColor = tooltipBody;
                diskBarChart.options.plugins.tooltip.borderColor = tooltipBorder;
            }
            diskBarChart.update('none');
        }

        // 4. App Trend Chart
        if (appTrendChart) {
            if (appTrendChart.options.scales.x) {
                appTrendChart.options.scales.x.grid.color = gridColor;
                appTrendChart.options.scales.x.ticks.color = tickColor;
            }
            if (appTrendChart.options.scales.y) {
                appTrendChart.options.scales.y.grid.color = gridColor;
                appTrendChart.options.scales.y.ticks.color = tickColor;
            }
            if (appTrendChart.options.plugins.tooltip) {
                appTrendChart.options.plugins.tooltip.backgroundColor = tooltipBg;
                appTrendChart.options.plugins.tooltip.titleColor = tooltipTitle;
                appTrendChart.options.plugins.tooltip.bodyColor = tooltipBody;
                appTrendChart.options.plugins.tooltip.borderColor = tooltipBorder;
            }
            appTrendChart.update('none');
        }
    }

    // =========================================================================
    // Chart.js Instances
    // =========================================================================
    let metricsChart = null;
    let diskDonutChart = null;
    let diskBarChart = null;
    let appTrendChart = null;
    let appShareChart = null;

    function initMetricsChart() {
        const ctx = document.getElementById('metricsChart').getContext('2d');
        
        const cpuGradient = ctx.createLinearGradient(0, 0, 0, 240);
        cpuGradient.addColorStop(0, 'rgba(194, 248, 59, 0.35)');
        cpuGradient.addColorStop(1, 'rgba(194, 248, 59, 0.0)');

        const ramGradient = ctx.createLinearGradient(0, 0, 0, 240);
        ramGradient.addColorStop(0, 'rgba(56, 189, 248, 0.30)');
        ramGradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

        metricsChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: state.chartData.labels,
                datasets: [
                    {
                        label: 'CPU Usage (%)',
                        data: state.chartData.cpuHistory,
                        borderColor: '#c2f83b',
                        backgroundColor: cpuGradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#c2f83b',
                        pointHoverBorderColor: '#0a0e14',
                        pointHoverBorderWidth: 2,
                    },
                    {
                        label: 'RAM Usage (%)',
                        data: state.chartData.ramHistory,
                        borderColor: '#38bdf8',
                        backgroundColor: ramGradient,
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        pointHoverBackgroundColor: '#38bdf8',
                        pointHoverBorderColor: '#0a0e14',
                        pointHoverBorderWidth: 2,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300, easing: 'linear' },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 24, 30, 0.96)',
                        titleColor: '#ffffff',
                        bodyColor: '#f1f5f9',
                        borderColor: 'rgba(194, 248, 59, 0.35)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true,
                        boxPadding: 4,
                        callbacks: {
                            label: (context) => ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8, autoSkip: true }
                    },
                    y: {
                        min: 0,
                        max: 100,
                        grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, stepSize: 20, callback: value => `${value}%` }
                    }
                }
            }
        });
    }

    function initDiskCharts() {
        const donutCtx = document.getElementById('diskDonutChart').getContext('2d');
        diskDonutChart = new Chart(donutCtx, {
            type: 'doughnut',
            data: {
                labels: ['Loading...'],
                datasets: [{
                    data: [100],
                    backgroundColor: ['rgba(255, 255, 255, 0.1)'],
                    borderColor: '#14171d',
                    borderWidth: 2,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: '#94a3b8',
                            font: { family: 'Plus Jakarta Sans', size: 11 },
                            boxWidth: 12,
                            padding: 10
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(20, 24, 30, 0.96)',
                        borderColor: 'rgba(194, 248, 59, 0.35)',
                        borderWidth: 1,
                        callbacks: {
                            label: (context) => ` ${context.label}: ${context.parsed} GB`
                        }
                    }
                }
            }
        });

        const barCtx = document.getElementById('diskBarChart').getContext('2d');
        diskBarChart = new Chart(barCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Size (GB)',
                    data: [],
                    backgroundColor: [
                        'rgba(194, 248, 59, 0.85)',
                        'rgba(56, 189, 248, 0.85)',
                        'rgba(52, 211, 153, 0.85)',
                        'rgba(251, 191, 36, 0.85)',
                        'rgba(248, 113, 113, 0.85)',
                        'rgba(167, 139, 250, 0.85)',
                        'rgba(244, 114, 182, 0.85)',
                        'rgba(148, 163, 184, 0.75)',
                    ],
                    borderRadius: 6,
                    borderSkipped: false,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(20, 24, 30, 0.96)',
                        borderColor: 'rgba(194, 248, 59, 0.35)',
                        borderWidth: 1,
                        callbacks: {
                            label: (context) => ` Size: ${context.parsed.x} GB`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v} GB` }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#f1f5f9', font: { family: 'Plus Jakarta Sans', size: 11 } }
                    }
                }
            }
        });
    }

    function initAppCharts() {
        const trendCanvas = document.getElementById('app-trend-chart');
        if (trendCanvas) {
            const ctx = trendCanvas.getContext('2d');
            appTrendChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Download (GB)',
                            data: [],
                            backgroundColor: 'rgba(194, 248, 59, 0.9)',
                            borderRadius: 5,
                            borderSkipped: false,
                        },
                        {
                            label: 'Upload (GB)',
                            data: [],
                            backgroundColor: 'rgba(56, 189, 248, 0.9)',
                            borderRadius: 5,
                            borderSkipped: false,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(20, 24, 30, 0.96)',
                            borderColor: 'rgba(194, 248, 59, 0.35)',
                            borderWidth: 1,
                            callbacks: {
                                label: (context) => ` ${context.dataset.label}: ${context.parsed.y} GB`
                            }
                        }
                    },
                    scales: {
                        x: {
                            grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                            ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 } }
                        },
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.04)', drawBorder: false },
                            ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, callback: v => `${v} GB` }
                        }
                    }
                }
            });
        }

        const shareCanvas = document.getElementById('app-share-chart');
        if (shareCanvas) {
            const ctx = shareCanvas.getContext('2d');
            appShareChart = new Chart(ctx, {
                type: 'doughnut',
                data: {
                    labels: ['Loading...'],
                    datasets: [{
                        data: [100],
                        backgroundColor: ['rgba(255, 255, 255, 0.1)'],
                        borderColor: '#14171d',
                        borderWidth: 2,
                        hoverOffset: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            labels: {
                                color: '#94a3b8',
                                font: { family: 'Plus Jakarta Sans', size: 10 },
                                boxWidth: 10,
                                boxHeight: 10,
                                padding: 8
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(20, 24, 30, 0.96)',
                            borderColor: 'rgba(194, 248, 59, 0.35)',
                            borderWidth: 1,
                            callbacks: {
                                label: (context) => ` ${context.label}: ${context.parsed} MB`
                            }
                        }
                    }
                }
            });
        }
    }

    // =========================================================================
    // Real-time Monitor Logic (Tab 1)
    // =========================================================================
    function updateChart(cpuVal, ramVal, timeLabel) {
        if (!metricsChart) return;

        state.chartData.labels.push(timeLabel);
        state.chartData.cpuHistory.push(cpuVal);
        state.chartData.ramHistory.push(ramVal);

        if (state.chartData.labels.length > state.maxHistoryPoints) {
            state.chartData.labels.shift();
            state.chartData.cpuHistory.shift();
            state.chartData.ramHistory.shift();
        }

        if (state.activeTab === 'overview') {
            metricsChart.update('none');
        }
    }

    function formatSpeed(kbs) {
        if (kbs >= 1024) return `${(kbs / 1024).toFixed(2)} <span class="net-unit">MB/s</span>`;
        return `${kbs.toFixed(1)} <span class="net-unit">KB/s</span>`;
    }

    function formatBytes(mb) {
        if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
        return `${mb.toFixed(1)} MB`;
    }

    function getLoadStatusChip(percent) {
        if (percent >= 85) return { text: 'Critical', class: 'chip-alert' };
        if (percent >= 65) return { text: 'High', class: 'chip-warn' };
        return { text: 'Normal', class: 'chip-normal' };
    }

    function formatShortCpuName(cpuModel) {
        if (!cpuModel) return 'Intel Engine';
        if (cpuModel.includes('Intel')) return 'Intel Core CPU';
        if (cpuModel.includes('AMD') || cpuModel.includes('Ryzen')) return 'AMD Ryzen CPU';
        if (cpuModel.length > 20) return cpuModel.slice(0, 18) + '...';
        return cpuModel;
    }

    function renderOverviewCards(data) {
        const { cpu, memory, disk, network, uptime, os } = data;

        // Sidebar info & Subtitle
        elements.sidebarSubHostname.textContent = os.hostname;
        elements.sidebarOsText.textContent = `${os.system} ${os.release} (${os.architecture})`;
        elements.sidebarUptime.textContent = uptime.uptime_formatted;
        
        if (elements.systemSubtitle) {
            elements.systemSubtitle.textContent = `${os.hostname} • ${formatShortCpuName(os.cpu_model)}`;
        }
        if (elements.systemSubtitleChip) {
            elements.systemSubtitleChip.title = `Hostname: ${os.hostname}\nCPU: ${os.cpu_model || 'System Engine'}\nOS: ${os.system} ${os.release} (${os.architecture})`;
        }
        elements.footerSyncTime.textContent = `Last update: ${data.time_iso}`;

        // Top Header Center: Quick System Status Pills
        const ghzText = cpu.frequency && cpu.frequency.current_ghz ? `${cpu.frequency.current_ghz} GHz` : (cpu.frequency.current_mhz ? `${cpu.frequency.current_mhz} MHz` : '-- GHz');
        if (elements.headCpuVal) {
            elements.headCpuVal.textContent = `${cpu.overall_percent.toFixed(1)}% • ${ghzText}`;
        }
        if (elements.headRamVal) {
            elements.headRamVal.textContent = `${memory.ram.percent.toFixed(1)}% (${memory.ram.used_gb.toFixed(1)} GB)`;
        }
        if (elements.headUptimeVal) {
            elements.headUptimeVal.textContent = uptime.uptime_formatted;
        }

        // CPU
        elements.cpuPercent.innerHTML = `${cpu.overall_percent.toFixed(1)}<span class="unit">%</span>`;
        elements.cpuProgressBar.style.width = `${Math.min(100, cpu.overall_percent)}%`;
        const cpuStatus = getLoadStatusChip(cpu.overall_percent);
        elements.cpuStatusTag.textContent = cpuStatus.text;
        elements.cpuStatusTag.className = `chip-status ${cpuStatus.class}`;
        elements.cpuFreqText.textContent = `Clock: ${ghzText}`;
        elements.cpuCoresText.textContent = `${cpu.logical_cores} Cores (${cpu.physical_cores}P)`;

        // Sync Matrix Rain speed with live CPU load
        if (typeof focusDeckManager !== 'undefined' && focusDeckManager.onMetricsUpdate) {
            focusDeckManager.onMetricsUpdate(cpu.overall_percent);
        }

        // RAM
        const ram = memory.ram;
        elements.ramPercent.innerHTML = `${ram.percent.toFixed(1)}<span class="unit">%</span>`;
        elements.ramProgressBar.style.width = `${Math.min(100, ram.percent)}%`;
        const ramStatus = getLoadStatusChip(ram.percent);
        elements.ramStatusTag.textContent = ramStatus.text;
        elements.ramStatusTag.className = `chip-status ${ramStatus.class}`;
        elements.ramUsedTotal.textContent = `${ram.used_gb.toFixed(1)} / ${ram.total_gb.toFixed(1)} GB`;
        elements.ramFree.textContent = `Free: ${ram.free_gb.toFixed(1)} GB`;

        // Disk
        const diskSum = disk.summary;
        elements.diskPercent.innerHTML = `${diskSum.percent.toFixed(1)}<span class="unit">%</span>`;
        elements.diskProgressBar.style.width = `${Math.min(100, diskSum.percent)}%`;
        elements.diskDrivesCount.textContent = `${disk.partitions.length} Drives`;
        elements.diskUsedTotal.textContent = `${diskSum.used_gb.toFixed(0)} GB / ${diskSum.total_gb.toFixed(0)} GB`;
        elements.diskFree.textContent = `Free: ${diskSum.free_gb.toFixed(0)} GB`;

        // Network
        elements.netDownSpeed.innerHTML = formatSpeed(network.download_kbs);
        elements.netUpSpeed.innerHTML = formatSpeed(network.upload_kbs);
        elements.netTotalRecv.textContent = `↓ Received: ${formatBytes(network.total_recv_mb)}`;
        elements.netTotalSent.textContent = `↑ Sent: ${formatBytes(network.total_sent_mb)}`;

        if (disk.io) {
            elements.diskIoRate.textContent = `IO: R: ${disk.io.read_speed_kbs.toFixed(0)} KB/s | W: ${disk.io.write_speed_kbs.toFixed(0)} KB/s`;
        }
    }

    function renderDrives(partitions) {
        if (!partitions || partitions.length === 0) {
            elements.drivesList.innerHTML = '<div class="loading-placeholder">No drives detected</div>';
            return;
        }

        const html = partitions.map(p => {
            const isDanger = p.percent >= 85 ? 'danger' : '';
            return `
                <div class="drive-item">
                    <div class="drive-header">
                        <div class="drive-name">
                            <span>${p.mountpoint || p.device}</span>
                            <span class="drive-fs">${p.fstype || 'Drive'}</span>
                        </div>
                        <div class="drive-usage-text">
                            ${p.used_gb.toFixed(1)} / ${p.total_gb.toFixed(1)} GB (${p.percent}%)
                        </div>
                    </div>
                    <div class="drive-progress-track">
                        <div class="drive-progress-fill ${isDanger}" style="width: ${Math.min(100, p.percent)}%;"></div>
                    </div>
                </div>
            `;
        }).join('');

        elements.drivesList.innerHTML = html;
    }

    function renderCoresGrid(perCorePercent) {
        if (!perCorePercent || perCorePercent.length === 0) return;
        elements.cpuSummaryBadge.textContent = `${perCorePercent.length} Active Cores`;

        const html = perCorePercent.map((val, idx) => `
            <div class="core-item">
                <div class="core-header">
                    <span class="core-name">Core ${idx}</span>
                    <span class="core-pct">${val.toFixed(0)}%</span>
                </div>
                <div class="core-progress-track">
                    <div class="core-progress-fill" style="width: ${Math.min(100, val)}%;"></div>
                </div>
            </div>
        `).join('');

        elements.coresGrid.innerHTML = html;
    }

    function renderProcessesTable(processesData) {
        if (!processesData) return;

        const totalCount = processesData.total_process_count || 0;
        elements.totalProcCount.textContent = `${totalCount} Processes`;

        let list = state.procSortMode === 'cpu' ? processesData.by_cpu : processesData.by_ram;
        if (!list) list = [];

        const q = state.procSearchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(p => 
                (p.name && p.name.toLowerCase().includes(q)) || 
                String(p.pid).includes(q) ||
                (p.username && p.username.toLowerCase().includes(q))
            );
        }

        if (list.length === 0) {
            elements.processesTbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center text-muted py-4">No matching processes found.</td>
                </tr>
            `;
            return;
        }

        const html = list.map(p => {
            let statusClass = 'status-other';
            if (p.status === 'running') statusClass = 'status-running';
            else if (p.status === 'sleeping' || p.status === 'idle') statusClass = 'status-sleeping';

            return `
                <tr>
                    <td class="proc-pid">#${p.pid}</td>
                    <td>
                        <div class="proc-name" title="${p.name}">
                            ${escapeHtml(p.name)}
                        </div>
                    </td>
                    <td class="text-muted">${escapeHtml(p.username)}</td>
                    <td>
                        <span class="proc-status-badge ${statusClass}">${p.status}</span>
                    </td>
                    <td>
                        <div class="table-bar-cell">
                            <div class="table-bar-track">
                                <div class="table-bar-fill cpu" style="width: ${Math.min(100, p.cpu_percent)}%;"></div>
                            </div>
                            <span class="table-bar-val">${p.cpu_percent.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td>
                        <div class="table-bar-cell">
                            <div class="table-bar-track">
                                <div class="table-bar-fill ram" style="width: ${Math.min(100, p.memory_percent)}%;"></div>
                            </div>
                            <span class="table-bar-val">${p.memory_percent.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td class="text-right proc-mem-mb">${p.memory_mb.toFixed(1)} MB</td>
                </tr>
            `;
        }).join('');

        elements.processesTbody.innerHTML = html;
    }

    // =========================================================================
    // Process Incoming WebSocket Stream
    // =========================================================================
    function processIncomingMetrics(data) {
        state.lastMetrics = data;
        if (state.isPaused) return;

        // 1. Telemetry Overview & Charts
        renderOverviewCards(data);
        updateChart(data.cpu.overall_percent, data.memory.ram.percent, data.time_iso);
        renderDrives(data.disk.partitions);
        renderCoresGrid(data.cpu.per_core_percent);
        renderProcessesTable(data.processes);

        // 2. Real-time 1:1 Action Center Toast Sync
        if (data.action_center_notifications !== undefined) {
            handleLiveActionCenterUpdate(data.action_center_notifications);
        }

        // 3. Real-time Network & Latency Widget Telemetry
        if (data.network_status) {
            renderSidebarNetworkWidget(data.network_status);
        }

        // 4. Real-time AI Smart Insights
        if (data.smart_insights) {
            renderAICopilotInsights(data.smart_insights);
        }

        // 5. Real-time Gemini Pro Status
        if (data.gemini_status) {
            state.geminiConfigured = data.gemini_status.configured;
            state.geminiModel = data.gemini_status.model || 'gemini-3.5-flash-lite';
            updateGeminiHeaderUI();
        }

        // 6. Update Live Telemetry Bar inside Expanded Chat
        updateExpandedChatTelemetry(data);

        // 7. Real-time Alert Threshold Gauges Update
        renderAlertGauges(data);

        // 8. Cyber Tamagotchi Virtual Desktop Pet Update
        if (typeof cyberPetManager !== 'undefined') {
            cyberPetManager.onMetricsUpdate(data);
        }
    }

    function updateExpandedChatTelemetry(data) {
        if (!data) return;
        if (elements.chatTelCpu && data.cpu) {
            const cpuVal = data.cpu.overall_percent !== undefined ? data.cpu.overall_percent : (data.cpu.total_percent || 0);
            elements.chatTelCpu.textContent = `${cpuVal}%`;
        }
        if (elements.chatTelRam && data.memory) {
            const ramPct = (data.memory.ram && data.memory.ram.percent !== undefined) ? data.memory.ram.percent : (data.memory.percent || 0);
            elements.chatTelRam.textContent = `${ramPct}%`;
        }
        if (elements.chatTelDisk && data.disk) {
            const diskPct = (data.disk.summary && data.disk.summary.percent !== undefined) ? data.disk.summary.percent : (data.disk.overall_percent || 0);
            elements.chatTelDisk.textContent = `${diskPct}%`;
        }
        if (elements.chatTelNet && data.network) {
            const dl = data.network.download_kbs || 0;
            const dlFormatted = dl >= 1024 ? `${(dl / 1024).toFixed(1)} MB/s` : `${dl.toFixed(0)} KB/s`;
            elements.chatTelNet.textContent = `↓ ${dlFormatted}`;
        }
        if (elements.chatTelHealth && data.smart_insights) {
            elements.chatTelHealth.textContent = `${data.smart_insights.health_score}/100`;
            elements.chatTelHealth.style.color = data.smart_insights.status_color === 'alert' ? '#f87171' : (data.smart_insights.status_color === 'warn' ? '#fbbf24' : '#c2f83b');
        }
    }

    function updateGeminiHeaderUI() {
        const modelShort = state.geminiConfigured 
            ? state.geminiModel.replace('gemini-', 'Gemini ').replace('-pro', ' Pro').replace('-flash', ' Flash').replace('-lite', ' Lite')
            : 'Gemini Pro AI';

        if (elements.copilotPanelTitle) {
            if (state.geminiConfigured) {
                elements.copilotPanelTitle.innerHTML = `<span style="background: linear-gradient(90deg, #60a5fa, #c084fc, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${escapeHtml(modelShort)}</span>`;
            } else {
                elements.copilotPanelTitle.textContent = 'Gemini Pro AI';
            }
        }
        if (elements.flyoutBotTitle) {
            if (state.geminiConfigured) {
                elements.flyoutBotTitle.innerHTML = `<span style="background: linear-gradient(90deg, #60a5fa, #c084fc, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${escapeHtml(modelShort)}</span>`;
            } else {
                elements.flyoutBotTitle.textContent = 'Gemini Pro AI';
            }
        }
        if (elements.expandedModalTitle) {
            elements.expandedModalTitle.textContent = state.geminiConfigured ? `Google ${state.geminiModel} AI Copilot` : 'System AI Copilot';
        }
    }

    function renderAICopilotInsights(insights) {
        if (!insights) return;

        // Health Score & Status Badge (Tab 1 Card & Header Flyout)
        if (elements.copilotScoreText) {
            elements.copilotScoreText.textContent = `${insights.health_score}/100`;
        }
        if (elements.flyoutScoreText) {
            elements.flyoutScoreText.textContent = `${insights.health_score}/100`;
        }

        const statusClass = insights.status_color === 'success' ? 'chip-normal' : (insights.status_color === 'warn' ? 'chip-warn' : (insights.status_color === 'alert' ? 'chip-alert' : 'chip-info'));

        if (elements.copilotHealthBadge) {
            elements.copilotHealthBadge.className = `chip-status ${statusClass}`;
            elements.copilotHealthBadge.innerHTML = `<span class="dot-online" style="${insights.status_color === 'alert' ? 'background:#ef4444;' : ''}"></span> <strong id="copilot-score-text">${insights.health_score}/100</strong>`;
        }
        if (elements.flyoutHealthBadge) {
            elements.flyoutHealthBadge.className = `chip-status ${statusClass}`;
            elements.flyoutHealthBadge.innerHTML = `<span class="dot-online" style="${insights.status_color === 'alert' ? 'background:#ef4444;' : ''}"></span> <strong id="flyout-score-text">${insights.health_score}/100</strong>`;
        }

        // Natural Language Insight Text
        const summaryText = insights.summary_vi || insights.summary_en;
        if (elements.copilotInsightText) {
            elements.copilotInsightText.textContent = summaryText;
        }
        if (elements.flyoutInsightText) {
            elements.flyoutInsightText.textContent = summaryText;
        }

        // Smart Suggestion Pills
        if (elements.copilotSuggestionsContainer && insights.suggestions) {
            const html = insights.suggestions.map(s => `
                <div class="copilot-suggestion-pill ${s.type}">
                    <span>${s.type === 'alert' ? '⚠️' : (s.type === 'warn' ? '⚡' : (s.type === 'success' ? '✅' : '💡'))}</span>
                    <span><strong>${escapeHtml(s.title)}:</strong> ${escapeHtml(s.text)}</span>
                </div>
            `).join('');
            elements.copilotSuggestionsContainer.innerHTML = html;
        }
    }

    function formatMarkdownToHtml(text) {
        if (!text) return '';
        let html = escapeHtml(text);
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.3);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:0.8rem;color:#38bdf8;">$1</code>');
        html = html.replace(/^\s*[\-\*]\s+(.*)$/gm, '<li style="margin-left:16px;list-style-type:disc;margin-top:4px;">$1</li>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // =========================================================================
    // Header Flyouts & Popups State Management
    // =========================================================================
    function toggleAiFlyout() {
        if (!elements.aiCopilotFlyout) return;
        const isHidden = elements.aiCopilotFlyout.classList.contains('hidden');

        // Close other dropdowns
        closeAllHeaderFlyouts();

        if (isHidden) {
            elements.aiCopilotFlyout.classList.remove('hidden');
            if (elements.btnHeaderAiCopilot) elements.btnHeaderAiCopilot.classList.add('active');
            if (elements.flyoutPromptInput) {
                setTimeout(() => elements.flyoutPromptInput.focus(), 80);
            }
        }
    }

    function toggleNotifDropdown() {
        if (!elements.notifOverviewDropdown) return;
        const isHidden = elements.notifOverviewDropdown.classList.contains('hidden');

        // Close other dropdowns
        closeAllHeaderFlyouts();

        if (isHidden) {
            elements.notifOverviewDropdown.classList.remove('hidden');
            if (elements.btnNotificationBell) elements.btnNotificationBell.classList.add('active');
            renderNotificationDropdown();
        }
    }

    function closeAllHeaderFlyouts() {
        if (elements.aiCopilotFlyout) {
            elements.aiCopilotFlyout.classList.add('hidden');
        }
        if (elements.notifOverviewDropdown) {
            elements.notifOverviewDropdown.classList.add('hidden');
        }
        if (elements.btnHeaderAiCopilot) {
            elements.btnHeaderAiCopilot.classList.remove('active');
        }
        if (elements.btnNotificationBell) {
            elements.btnNotificationBell.classList.remove('active');
        }
    }

    function appendFlyoutChatMessage(sender, text, isBot) {
        if (!elements.flyoutMessagesContainer) return;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isBot ? 'bot-msg' : 'user-msg'}`;

        const avatarIcon = isBot ? '✨' : '👤';
        const formattedBody = isBot ? formatMarkdownToHtml(text) : escapeHtml(text);

        msgDiv.innerHTML = `
            <div class="chat-avatar ${isBot ? 'bot-avatar' : 'user-avatar'}" style="width:26px;height:26px;font-size:0.8rem;">${avatarIcon}</div>
            <div class="chat-bubble ${isBot ? 'bot-bubble' : 'user-bubble'}" style="padding:9px 12px;font-size:0.80rem;">
                <div class="chat-msg-header">
                    <span class="chat-sender-name">${escapeHtml(sender)}</span>
                    <span class="chat-time-tag">${timeStr}</span>
                </div>
                <div class="chat-msg-text">${formattedBody}</div>
            </div>
        `;

        elements.flyoutMessagesContainer.appendChild(msgDiv);
        elements.flyoutMessagesContainer.scrollTop = elements.flyoutMessagesContainer.scrollHeight;
    }

    async function submitFlyoutQuestion(question) {
        if (!question || !question.trim()) return;

        const q = question.trim();
        if (elements.flyoutPromptInput) elements.flyoutPromptInput.value = '';

        appendFlyoutChatMessage('You', q, false);
        appendExpandedChatMessage('You', q, false);

        // Add loading placeholder in Flyout
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-msg bot-msg';
        loadingDiv.id = 'flyout-loading-bubble';
        loadingDiv.innerHTML = `
            <div class="chat-avatar bot-avatar" style="width:26px;height:26px;font-size:0.8rem;">✨</div>
            <div class="chat-bubble bot-bubble" style="padding:9px 12px;font-size:0.80rem;">
                <div class="chat-msg-header">
                    <span class="chat-sender-name">Gemini AI Copilot</span>
                    <span class="chat-time-tag">${timeStr}</span>
                </div>
                <div class="chat-msg-text text-muted">
                    <span class="ai-sparkle">✨</span> Đang phân tích dữ liệu phần cứng...
                </div>
            </div>
        `;
        elements.flyoutMessagesContainer.appendChild(loadingDiv);
        elements.flyoutMessagesContainer.scrollTop = elements.flyoutMessagesContainer.scrollHeight;

        if (elements.btnFlyoutSend) elements.btnFlyoutSend.classList.add('loading');

        try {
            const res = await fetch('/api/insights/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q }),
            });

            const loadingEl = document.getElementById('flyout-loading-bubble');
            if (loadingEl) loadingEl.remove();

            if (res.ok) {
                const data = await res.json();
                const answerRaw = data.answer || 'No response generated.';
                const botSender = state.geminiConfigured ? `Gemini (${data.model || state.geminiModel})` : 'AI Copilot';
                appendFlyoutChatMessage(botSender, answerRaw, true);
                appendExpandedChatMessage(botSender, answerRaw, true);
            } else {
                appendFlyoutChatMessage('Gemini Error', '⚠️ Lỗi không thể kết nối tới engine AI.', true);
            }
        } catch (e) {
            const loadingEl = document.getElementById('flyout-loading-bubble');
            if (loadingEl) loadingEl.remove();
            appendFlyoutChatMessage('Network Error', '⚠️ Lỗi kết nối mạng.', true);
        } finally {
            if (elements.btnFlyoutSend) elements.btnFlyoutSend.classList.remove('loading');
        }
    }

    function renderNotificationDropdown() {
        if (!elements.notifDropdownList) return;

        if (elements.dropdownUnreadPill) {
            elements.dropdownUnreadPill.textContent = `${state.totalUnreadCount} Chưa đọc`;
        }

        // Merge latest toasts and top event logs (up to 8 items)
        const combined = [
            ...state.toastNotifications.map(t => ({ ...t, is_toast: true })),
            ...state.eventLogNotifications.map(e => ({ ...e, is_toast: false }))
        ].slice(0, 8);

        if (combined.length === 0) {
            elements.notifDropdownList.innerHTML = `
                <div class="notif-empty-state" style="padding:28px 16px;font-size:0.82rem;color:var(--text-secondary);text-align:center;">
                    <span>🔔 Hiện không có thông báo nào mới.</span>
                </div>
            `;
            return;
        }

        const html = combined.map(n => {
            const levelLower = (n.level || 'info').toLowerCase();
            const unreadClass = !n.read ? 'unread' : '';
            const appTitle = n.is_toast ? (n.app_name || n.title || 'App Toast') : (n.title || 'System Event');
            const iconBadge = n.is_toast ? (n.app_icon || '🔔') : (levelLower === 'error' ? '❌' : (levelLower === 'warning' ? '⚠️' : 'ℹ️'));

            return `
                <div class="notif-dropdown-item ${unreadClass}" data-id="${escapeHtml(n.id)}">
                    <div class="notif-item-icon-box">${iconBadge}</div>
                    <div class="notif-item-content">
                        <div class="notif-item-header">
                            <span class="notif-item-app">${escapeHtml(appTitle)}</span>
                            <span class="notif-item-time">${escapeHtml(n.time_ago || '')}</span>
                        </div>
                        <div class="notif-item-text">${escapeHtml(n.message || n.sub_text || '')}</div>
                        <button class="notif-item-detail-btn" data-id="${escapeHtml(n.id)}">
                            Xem chi tiết ↗
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        elements.notifDropdownList.innerHTML = html;

        // Attach Click to Detail/Row
        elements.notifDropdownList.querySelectorAll('.notif-dropdown-item').forEach(itemEl => {
            itemEl.addEventListener('click', (e) => {
                const id = itemEl.getAttribute('data-id');
                navigateToNotificationDetail(id);
            });
        });
    }

    function navigateToNotificationDetail(notifId) {
        closeAllHeaderFlyouts();
        switchTab('notifications');

        setTimeout(() => {
            if (!notifId) return;
            const targetEl = document.querySelector(`.notif-item[data-id="${notifId}"]`);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                targetEl.classList.add('notif-highlight-flash');
                setTimeout(() => {
                    targetEl.classList.remove('notif-highlight-flash');
                }, 3000);
            }
        }, 150);
    }

    async function submitCopilotQuestion(question) {
        if (!question || !question.trim()) return;

        const q = question.trim();
        if (elements.copilotPromptInput) elements.copilotPromptInput.value = '';

        // Also submit into flyout stream
        submitFlyoutQuestion(q);
    }

    function appendExpandedChatMessage(sender, text, isBot) {
        if (!elements.expandedMessagesContainer) return;

        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-msg ${isBot ? 'bot-msg' : 'user-msg'}`;

        const avatarIcon = isBot ? '✨' : '👤';
        const formattedBody = isBot ? formatMarkdownToHtml(text) : escapeHtml(text);

        msgDiv.innerHTML = `
            <div class="chat-avatar ${isBot ? 'bot-avatar' : 'user-avatar'}">${avatarIcon}</div>
            <div class="chat-bubble ${isBot ? 'bot-bubble' : 'user-bubble'}">
                <div class="chat-msg-header">
                    <span class="chat-sender-name">${escapeHtml(sender)}</span>
                    <span class="chat-time-tag">${timeStr}</span>
                </div>
                <div class="chat-msg-text">${formattedBody}</div>
            </div>
        `;

        elements.expandedMessagesContainer.appendChild(msgDiv);
        elements.expandedMessagesContainer.scrollTop = elements.expandedMessagesContainer.scrollHeight;
    }

    async function submitExpandedChatQuestion(question) {
        if (!question || !question.trim()) return;

        const q = question.trim();
        if (elements.expandedPromptInput) elements.expandedPromptInput.value = '';

        appendExpandedChatMessage('You', q, false);
        appendFlyoutChatMessage('You', q, false);

        // Add loading bot placeholder
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-msg bot-msg';
        loadingDiv.id = 'expanded-loading-bubble';
        loadingDiv.innerHTML = `
            <div class="chat-avatar bot-avatar">✨</div>
            <div class="chat-bubble bot-bubble">
                <div class="chat-msg-header">
                    <span class="chat-sender-name">Gemini AI Copilot</span>
                    <span class="chat-time-tag">${timeStr}</span>
                </div>
                <div class="chat-msg-text text-muted">
                    <span class="ai-sparkle">✨</span> Analyzing real-time hardware telemetry and processes...
                </div>
            </div>
        `;
        elements.expandedMessagesContainer.appendChild(loadingDiv);
        elements.expandedMessagesContainer.scrollTop = elements.expandedMessagesContainer.scrollHeight;

        if (elements.btnExpandedSend) elements.btnExpandedSend.classList.add('loading');

        try {
            const res = await fetch('/api/insights/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: q }),
            });

            const loadingEl = document.getElementById('expanded-loading-bubble');
            if (loadingEl) loadingEl.remove();

            if (res.ok) {
                const data = await res.json();
                const answerRaw = data.answer || 'No response generated.';
                const botSender = state.geminiConfigured ? `Gemini (${data.model || state.geminiModel})` : 'AI Copilot';
                appendExpandedChatMessage(botSender, answerRaw, true);
                appendFlyoutChatMessage(botSender, answerRaw, true);
            } else {
                appendExpandedChatMessage('Gemini Error', '⚠️ Failed to get answer from AI engine.', true);
            }
        } catch (e) {
            const loadingEl = document.getElementById('expanded-loading-bubble');
            if (loadingEl) loadingEl.remove();
            appendExpandedChatMessage('Network Error', '⚠️ Could not connect to AI service.', true);
        } finally {
            if (elements.btnExpandedSend) elements.btnExpandedSend.classList.remove('loading');
        }
    }

    function openExpandedChatModal() {
        if (elements.geminiChatExpandedModal) {
            elements.geminiChatExpandedModal.classList.remove('hidden');
            if (elements.expandedPromptInput) elements.expandedPromptInput.focus();
            if (elements.expandedMessagesContainer) {
                elements.expandedMessagesContainer.scrollTop = elements.expandedMessagesContainer.scrollHeight;
            }
        }
    }

    function closeExpandedChatModal() {
        if (elements.geminiChatExpandedModal) {
            elements.geminiChatExpandedModal.classList.add('hidden');
        }
    }

    function renderSidebarNetworkWidget(netStatus) {
        if (!netStatus) return;

        if (elements.sidebarPingVal) {
            if (netStatus.ping_ms !== null && netStatus.ping_ms !== undefined) {
                elements.sidebarPingVal.textContent = `${netStatus.ping_ms} ms`;
                if (netStatus.ping_ms < 60) {
                    elements.sidebarPingVal.style.color = '#10b981'; // green
                } else if (netStatus.ping_ms < 150) {
                    elements.sidebarPingVal.style.color = '#f59e0b'; // amber
                } else {
                    elements.sidebarPingVal.style.color = '#ef4444'; // red
                }
            } else {
                elements.sidebarPingVal.textContent = '-- ms';
                elements.sidebarPingVal.style.color = 'var(--text-muted)';
            }
        }

        if (elements.sidebarLocalIp && netStatus.local_ip) {
            elements.sidebarLocalIp.textContent = netStatus.local_ip;
        }

        if (elements.sidebarNetStatusPill) {
            if (netStatus.online) {
                elements.sidebarNetStatusPill.className = 'chip-status chip-normal';
                elements.sidebarNetStatusPill.innerHTML = '<span class="dot-online"></span> Online';
            } else {
                elements.sidebarNetStatusPill.className = 'chip-status chip-alert';
                elements.sidebarNetStatusPill.innerHTML = '<span class="dot-live" style="background:#ef4444;"></span> Offline';
            }
        }
    }

    function handleLiveActionCenterUpdate(liveToasts) {
        const currentHash = liveToasts.map(t => t.id).join(',');

        if (currentHash !== state.lastToastIdsHash) {
            state.lastToastIdsHash = currentHash;
            state.toastNotifications = liveToasts;

            // Recalculate unread status with localStorage
            recalculateUnreadCounts();

            // Re-render Hub view if active
            if (state.activeTab === 'notifications') {
                renderNotificationsHub();
            }
        }
    }

    function setConnectionStatus(status) {
        elements.wsStatus.className = `status-indicator status-${status}`;
        if (status === 'connected') {
            elements.wsStatus.innerHTML = '<span class="status-dot"></span><span class="status-text">Connected (1s)</span>';
        } else if (status === 'connecting') {
            elements.wsStatus.innerHTML = '<span class="status-dot"></span><span class="status-text">Reconnecting...</span>';
        } else {
            elements.wsStatus.innerHTML = '<span class="status-dot"></span><span class="status-text">Disconnected</span>';
        }
    }

    function connectWebSocket() {
        if (state.socket) {
            try { state.socket.close(); } catch (e) {}
        }

        const wsUrl = `${WS_BASE}/ws/metrics`;

        setConnectionStatus('connecting');

        try {
            state.socket = new WebSocket(wsUrl);

            state.socket.onopen = () => {
                setConnectionStatus('connected');
                if (state.reconnectTimer) {
                    clearTimeout(state.reconnectTimer);
                    state.reconnectTimer = null;
                }
            };

            state.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    processIncomingMetrics(data);
                } catch (err) {
                    console.error('Error parsing metrics payload:', err);
                }
            };

            state.socket.onclose = () => {
                setConnectionStatus('disconnected');
                scheduleReconnect();
            };

            state.socket.onerror = (err) => {
                console.warn('WebSocket encountered error:', err);
                setConnectionStatus('disconnected');
            };
        } catch (e) {
            setConnectionStatus('disconnected');
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        if (!state.reconnectTimer) {
            state.reconnectTimer = setTimeout(() => {
                state.reconnectTimer = null;
                connectWebSocket();
            }, 2500);
        }
    }

    async function fetchMetricsSnapshot() {
        try {
            const res = await fetch('/api/metrics');
            if (res.ok) {
                const data = await res.json();
                processIncomingMetrics(data);
            }
        } catch (e) {
            console.error('Error fetching REST snapshot:', e);
        }
    }

    // =========================================================================
    // Notifications & Events Hub Logic (Tab 3)
    // =========================================================================
    async function fetchNotifications(force = false) {
        if (force && elements.hubRefreshIcon) {
            elements.hubRefreshIcon.classList.add('spin');
        }

        const storedReadIds = getStoredReadIds();

        try {
            const [actionRes, eventRes] = await Promise.allSettled([
                fetch(`/api/notifications/action-center?force=${force}`),
                fetch(`/api/notifications?force=${force}`)
            ]);

            // 1. Action Center Toast Notifications
            if (actionRes.status === 'fulfilled' && actionRes.value.ok) {
                const actionData = await actionRes.value.json();
                const toasts = actionData.notifications || [];
                toasts.forEach(t => {
                    t.read = storedReadIds.has(t.id);
                });
                state.toastNotifications = toasts;
                state.lastToastIdsHash = toasts.map(t => t.id).join(',');
            }

            // 2. Windows Event Log Notifications
            if (eventRes.status === 'fulfilled' && eventRes.value.ok) {
                const eventData = await eventRes.value.json();
                const events = eventData.notifications || [];
                events.forEach(e => {
                    e.read = storedReadIds.has(e.id);
                });
                state.eventLogNotifications = events;
            }

            // 3. Recalculate unread counts & update UI
            recalculateUnreadCounts();
            renderNotificationsHub();
        } catch (e) {
            console.error('Error fetching dual-source notifications:', e);
        } finally {
            if (elements.hubRefreshIcon) {
                elements.hubRefreshIcon.classList.remove('spin');
            }
        }
    }

    function recalculateUnreadCounts() {
        const storedReadIds = getStoredReadIds();

        // Update read status from localStorage
        state.toastNotifications.forEach(t => { t.read = storedReadIds.has(t.id); });
        state.eventLogNotifications.forEach(e => { e.read = storedReadIds.has(e.id); });

        // Unread counts are computed strictly against ACTIVE items
        state.toastUnreadCount = state.toastNotifications.filter(t => !t.read).length;
        state.eventLogUnreadCount = state.eventLogNotifications.filter(e => !e.read).length;
        state.totalUnreadCount = state.toastUnreadCount + state.eventLogUnreadCount;

        // 1. Header & Sidebar Glowing Badges
        const unreadText = state.totalUnreadCount > 99 ? '99+' : state.totalUnreadCount;

        if (state.totalUnreadCount > 0) {
            elements.sidebarNotifBadge.textContent = unreadText;
            elements.sidebarNotifBadge.classList.remove('hidden');
            elements.notifBadgeCount.textContent = unreadText;
            elements.notifBadgeCount.classList.remove('hidden');
        } else {
            elements.sidebarNotifBadge.classList.add('hidden');
            elements.notifBadgeCount.classList.add('hidden');
        }

        // 2. Hub Summary Stat Pills
        if (elements.hubCountToasts) elements.hubCountToasts.textContent = state.toastNotifications.length;
        if (elements.hubCountEvents) elements.hubCountEvents.textContent = state.eventLogNotifications.length;
        if (elements.hubCountUnread) elements.hubCountUnread.textContent = state.totalUnreadCount;
        if (elements.hubToastsBadge) elements.hubToastsBadge.textContent = state.toastNotifications.length;
        if (elements.hubEventsBadge) elements.hubEventsBadge.textContent = state.eventLogNotifications.length;

        // 3. Sync Header Quick Dropdown Preview
        renderNotificationDropdown();
    }

    function renderNotificationsHub() {
        renderHubToastsColumn();
        renderHubEventsColumn();
    }

    function renderHubToastsColumn() {
        let list = [...state.toastNotifications];
        const q = state.hubSearchQuery.trim().toLowerCase();

        // Filter out if user selected a severity category that only applies to event logs
        if (state.hubFilter !== 'all' && state.hubFilter !== 'toasts') {
            elements.hubToastsContainer.innerHTML = `
                <div class="notif-empty-state">Filtering by ${state.hubFilter} (Event Logs only).</div>
            `;
            return;
        }

        if (q) {
            list = list.filter(t => 
                (t.app_name && t.app_name.toLowerCase().includes(q)) ||
                (t.title && t.title.toLowerCase().includes(q)) ||
                (t.body && t.body.toLowerCase().includes(q))
            );
        }

        if (!list || list.length === 0) {
            elements.hubToastsContainer.innerHTML = `
                <div class="notif-empty-state">No active toast notifications in Windows Action Center.</div>
            `;
            return;
        }

        const html = list.map(t => {
            const readClass = t.read ? 'read' : '';
            return `
                <div class="toast-item ${readClass}" data-id="${t.id}">
                    <div class="toast-item-header">
                        <div class="toast-app-group">
                            <span class="toast-app-icon">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                                    <line x1="12" y1="18" x2="12.01" y2="18"></line>
                                </svg>
                            </span>
                            <span class="toast-app-name" title="${escapeHtml(t.app_name)}">${escapeHtml(t.app_name)}</span>
                        </div>
                        <span class="notif-time">${t.time_ago}</span>
                    </div>

                    ${t.title ? `<div class="toast-title">${escapeHtml(t.title)}</div>` : ''}
                    ${t.body ? `<div class="toast-body">${escapeHtml(t.body)}</div>` : ''}

                    <div class="notif-item-bottom">
                        <span class="notif-channel-tag">[${t.type}] ${t.time ? t.time.split(' ')[1] : ''}</span>
                        ${!t.read ? `<button class="notif-read-btn" data-id="${t.id}" title="Mark as read">✓ Mark read</button>` : `<span class="text-muted">Read</span>`}
                    </div>
                </div>
            `;
        }).join('');

        elements.hubToastsContainer.innerHTML = html;

        // Attach click listeners to individual mark read buttons
        elements.hubToastsContainer.querySelectorAll('.notif-read-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                markSingleNotificationRead(id);
            });
        });
    }

    function renderHubEventsColumn() {
        let list = [...state.eventLogNotifications];
        const q = state.hubSearchQuery.trim().toLowerCase();

        // If user selected "toasts only", show placeholder
        if (state.hubFilter === 'toasts') {
            elements.hubEventsContainer.innerHTML = `
                <div class="notif-empty-state">App Toasts Only filter is active.</div>
            `;
            return;
        }

        // Apply Category Filters
        if (state.hubFilter !== 'all') {
            if (state.hubFilter === 'Error') {
                list = list.filter(n => n.level === 'Error' || n.level === 'Critical');
            } else {
                list = list.filter(n => n.level === state.hubFilter);
            }
        }

        // Apply Search
        if (q) {
            list = list.filter(n => 
                (n.title && n.title.toLowerCase().includes(q)) ||
                (n.message && n.message.toLowerCase().includes(q)) ||
                String(n.event_id).includes(q) ||
                (n.channel && n.channel.toLowerCase().includes(q))
            );
        }

        if (!list || list.length === 0) {
            elements.hubEventsContainer.innerHTML = `
                <div class="notif-empty-state">No matching Windows event logs found.</div>
            `;
            return;
        }

        const html = list.map(n => {
            const levelLower = (n.level || 'info').toLowerCase();
            const readClass = n.read ? 'read' : '';

            let iconSvg = '';
            if (levelLower === 'error' || levelLower === 'critical') {
                iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`;
            } else if (levelLower === 'warning') {
                iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
            } else {
                iconSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
            }

            return `
                <div class="notif-item level-${levelLower} ${readClass}" data-id="${n.id}">
                    <div class="notif-item-top">
                        <div class="notif-item-title-group">
                            <span class="notif-icon">${iconSvg}</span>
                            <span class="notif-provider" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</span>
                        </div>
                        <div class="notif-item-meta">
                            <span class="notif-level-badge">${n.level}</span>
                            <span class="notif-time">${n.time_ago}</span>
                        </div>
                    </div>
                    <div class="notif-item-message">
                        ${escapeHtml(n.message)}
                    </div>
                    <div class="notif-item-bottom">
                        <span class="notif-channel-tag">[${n.channel}] Event #${n.event_id}</span>
                        ${!n.read ? `<button class="notif-read-btn" data-id="${n.id}" title="Mark as read">✓ Mark read</button>` : `<span class="text-muted">Read</span>`}
                    </div>
                </div>
            `;
        }).join('');

        elements.hubEventsContainer.innerHTML = html;

        // Attach click listeners to mark read buttons
        elements.hubEventsContainer.querySelectorAll('.notif-read-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.getAttribute('data-id');
                markSingleNotificationRead(id);
            });
        });
    }

    function markSingleNotificationRead(id) {
        if (!id) return;
        saveStoredReadId(id);

        try {
            fetch(`/api/notifications/mark-read?id=${encodeURIComponent(id)}`, { method: 'POST' });
        } catch (e) {}

        recalculateUnreadCounts();
        renderNotificationsHub();
    }

    function markAllNotificationsRead() {
        const allIds = [
            ...state.toastNotifications.map(t => t.id),
            ...state.eventLogNotifications.map(e => e.id)
        ];

        saveAllStoredReadIds(allIds);

        try {
            fetch('/api/notifications/mark-read', { method: 'POST' });
        } catch (e) {}

        recalculateUnreadCounts();
        renderNotificationsHub();
    }

    // =========================================================================
    // Disk Analysis Breakdown Logic (Tab 2)
    // =========================================================================
    async function loadAvailableDrives() {
        try {
            const res = await fetch('/api/disk/available-drives');
            if (res.ok) {
                const drives = await res.json();
                if (drives && drives.length > 0) {
                    state.availableDrives = drives.map(d => d.drive);
                    renderDrivePills(drives);
                }
            }
        } catch (e) {
            console.error('Error fetching available drives:', e);
        }
    }

    function renderDrivePills(drives) {
        const html = drives.map(d => {
            const isActive = d.drive === state.selectedDrive ? 'active' : '';
            return `
                <button class="drive-pill ${isActive}" data-drive="${d.drive}">
                    Drive ${d.drive}\\ (${d.total_gb} GB)
                </button>
            `;
        }).join('');

        elements.diskDriveSelectors.innerHTML = html;

        elements.diskDriveSelectors.querySelectorAll('.drive-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                const drive = btn.getAttribute('data-drive');
                if (drive && drive !== state.selectedDrive) {
                    state.selectedDrive = drive;
                    elements.diskDriveSelectors.querySelectorAll('.drive-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    fetchDiskBreakdown(drive, false);
                }
            });
        });
    }

    async function fetchDiskBreakdown(drive, force = false) {
        if (state.isDiskScanning) return;
        state.isDiskScanning = true;

        elements.diskSpinIcon.classList.add('spin');
        elements.diskBtnText.textContent = 'Scanning...';
        elements.diskScanStatus.innerHTML = `<span class="badge-dot-scanning"></span> Scanning directory structure on drive ${drive}...`;
        elements.diskBreakdownTbody.innerHTML = `
            <tr>
                <td colspan="6" class="text-center text-muted py-4">Analyzing storage breakdown for drive ${drive}... Please wait.</td>
            </tr>
        `;

        try {
            const res = await fetch(`/api/disk/usage-breakdown?drive=${encodeURIComponent(drive)}&force=${force}`);
            if (res.ok) {
                const data = await res.json();
                state.diskBreakdownData = data;
                renderDiskBreakdownView(data);
            } else {
                elements.diskScanStatus.innerHTML = '<span class="chip-alert">Error scanning drive</span>';
            }
        } catch (err) {
            console.error('Error scanning disk:', err);
            elements.diskScanStatus.innerHTML = '<span class="chip-alert">Server connection error</span>';
        } finally {
            state.isDiskScanning = false;
            elements.diskSpinIcon.classList.remove('spin');
            elements.diskBtnText.textContent = 'Scan Now';
        }
    }

    function renderDiskBreakdownView(data) {
        const cacheInfo = data.is_cached ? `(Cached ${data.cache_age_sec}s ago)` : '(Fresh scan)';
        elements.diskScanStatus.innerHTML = `<span class="badge-dot-idle"></span> Completed in ${data.scan_duration_sec}s ${cacheInfo}`;

        // 1. Total Drive Card
        elements.diskAnalyzedDriveName.textContent = `Drive ${data.drive}\\`;
        elements.diskCardTotal.innerHTML = `${data.total_gb.toFixed(1)}<span class="unit">GB</span>`;
        elements.diskCardBar.style.width = `${Math.min(100, data.used_percent)}%`;
        elements.diskCardUsed.textContent = `Used: ${data.used_gb.toFixed(1)} GB`;
        elements.diskCardPercentUsed.textContent = `${data.used_percent}% full`;

        // 2. Analyzed Card
        elements.diskCardAnalyzed.innerHTML = `${data.analyzed_total_gb.toFixed(1)}<span class="unit">GB</span>`;
        const pctOfDrive = data.total_gb > 0 ? (data.analyzed_total_gb / data.total_gb * 100) : 0;
        elements.diskCardAnalyzedBar.style.width = `${Math.min(100, pctOfDrive)}%`;
        elements.diskCardAnalyzedPct.textContent = `Takes ${pctOfDrive.toFixed(1)}% of drive`;
        elements.diskCardItemsCount.textContent = `${data.item_count} Level-1 Items`;

        // 3. Free Space Card
        elements.diskCardFree.innerHTML = `${data.free_gb.toFixed(1)}<span class="unit">GB</span>`;
        const freePct = data.total_gb > 0 ? (data.free_gb / data.total_gb * 100) : 0;
        elements.diskCardFreeBar.style.width = `${Math.min(100, freePct)}%`;
        elements.diskCardFreePct.textContent = `Free: ${freePct.toFixed(1)}%`;
        elements.diskFreeTag.textContent = freePct < 15 ? 'Low Space' : 'Available';
        elements.diskFreeTag.className = `chip-status ${freePct < 15 ? 'chip-alert' : 'chip-normal'}`;

        // 4. Duration / Cache Card
        elements.diskCardDuration.innerHTML = `${data.scan_duration_sec}<span class="unit">s</span>`;
        elements.diskCardLastScan.textContent = `At: ${data.scanned_at.split(' ')[1] || data.scanned_at}`;
        elements.diskCardCacheInfo.textContent = data.is_cached ? `Loaded from cache` : `Directly scanned`;
        elements.diskCacheTag.textContent = data.is_cached ? 'Cached' : 'Fresh';

        // Update Charts
        updateDiskDonutChart(data);
        updateDiskBarChart(data);

        // Render Table
        renderDiskTable(data.items);
    }

    function updateDiskDonutChart(data) {
        if (!diskDonutChart) return;

        const topItems = data.items.slice(0, 5);
        const topLabels = topItems.map(i => i.name);
        const topValues = topItems.map(i => i.size_gb);

        const sumTop = topValues.reduce((a, b) => a + b, 0);
        const otherUsed = Math.max(0, data.used_gb - sumTop);

        const labels = [...topLabels, 'Other Folders', 'Free Space'];
        const values = [...topValues, round2(otherUsed), round2(data.free_gb)];

        const colors = [
            '#06b6d4', // cyan
            '#8b5cf6', // purple
            '#f59e0b', // amber
            '#ec4899', // pink
            '#3b82f6', // blue
            '#6b7280', // gray
            '#10b981', // green
        ];

        diskDonutChart.data.labels = labels;
        diskDonutChart.data.datasets[0].data = values;
        diskDonutChart.data.datasets[0].backgroundColor = colors.slice(0, labels.length);
        diskDonutChart.update();
    }

    function updateDiskBarChart(data) {
        if (!diskBarChart) return;

        const top8 = data.items.slice(0, 8);
        const labels = top8.map(i => i.name);
        const values = top8.map(i => i.size_gb);

        diskBarChart.data.labels = labels;
        diskBarChart.data.datasets[0].data = values;
        diskBarChart.update();
    }

    function isFilePreviewable(fileNameOrPath) {
        if (!fileNameOrPath) return false;
        const lastDot = fileNameOrPath.lastIndexOf('.');
        if (lastDot === -1) return false;
        const ext = fileNameOrPath.substring(lastDot).toLowerCase();
        const previewableExts = [
            '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico', '.avif', '.tif', '.tiff',
            '.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.ts', '.ogv',
            '.pdf',
            '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac',
            '.txt', '.log', '.json', '.py', '.js', '.css', '.html', '.htm', '.md', '.sql', '.yaml', '.yml', '.xml', '.csv', '.sh', '.ps1', '.ini', '.cfg', '.conf'
        ];
        return previewableExts.includes(ext);
    }

    function getPreviewBadgeClass(fileNameOrPath) {
        if (!fileNameOrPath) return '';
        const lastDot = fileNameOrPath.lastIndexOf('.');
        if (lastDot === -1) return '';
        const ext = fileNameOrPath.substring(lastDot).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp', '.ico', '.avif', '.tif', '.tiff'].includes(ext)) {
            return 'btn-preview-image';
        }
        if (['.pdf'].includes(ext)) {
            return 'btn-preview-pdf';
        }
        return '';
    }

    function getSafeRowId(path) {
        return 'subrow-' + encodeURIComponent(path).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    function renderDiskTable(items) {
        if (!items) return;

        elements.diskTableTotalCount.textContent = `${items.length} Items`;

        let list = [...items];
        const q = state.diskSearchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(i => (i.name && i.name.toLowerCase().includes(q)) || (i.path && i.path.toLowerCase().includes(q)));
        }

        if (list.length === 0) {
            elements.diskBreakdownTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-4">Không tìm thấy thư mục hoặc tệp tin phù hợp.</td>
                </tr>
            `;
            return;
        }

        const html = list.map((item, idx) => {
            const isDir = item.is_dir;
            const isExpanded = isDir && state.expandedFolders.has(item.path);
            const badgeClass = isDir ? 'folder-badge' : 'file-badge';
            const expandableClass = isDir ? 'disk-row-expandable' : '';
            const expandedClass = isExpanded ? 'expanded' : '';
            const chevron = isDir 
                ? `<button type="button" class="disk-chevron-btn ${isExpanded ? 'rotated' : ''}" title="Bấm để mở rộng / thu gọn thư mục con (Cấp 2)">▶</button>` 
                : `<span class="disk-chevron-spacer"></span>`;
            const rowTitleHint = isDir ? 'Bấm để mở rộng / thu gọn thư mục con (Cấp 2)' : '';

            const previewBtn = (!isDir && isFilePreviewable(item.name || item.path)) 
                ? `<button type="button" class="btn-preview-file ${getPreviewBadgeClass(item.name || item.path)}" data-preview-path="${escapeHtml(item.path)}" title="Xem trực tiếp trên trình duyệt (Ảnh, Video, PDF, Code)">👁️ Xem</button>` 
                : '';

            const iconSvg = isDir 
                ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
                : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

            return `
                <tr class="${expandableClass} ${expandedClass}" data-path="${escapeHtml(item.path)}" data-depth="1" title="${rowTitleHint}">
                    <td class="proc-pid">#${idx + 1}</td>
                    <td>
                        <div class="disk-item-flex-cell">
                            ${chevron}
                            <span class="disk-icon-badge ${badgeClass}">${iconSvg}</span>
                            <div class="disk-name-text-group">
                                <span class="disk-main-name">${escapeHtml(item.name)}</span>
                                <span class="disk-path-muted">${escapeHtml(item.path)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="item-type-badge ${badgeClass}">${item.type}</span>
                            ${previewBtn}
                        </div>
                    </td>
                    <td>
                        <strong class="mono-text" style="color: var(--text-white); font-size: 0.90rem;">${item.size_formatted}</strong>
                    </td>
                    <td>
                        <div class="table-bar-cell">
                            <div class="table-bar-track">
                                <div class="table-bar-fill cpu" style="width: ${Math.min(100, item.percent_of_drive)}%;"></div>
                            </div>
                            <span class="table-bar-val">${item.percent_of_drive.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td class="text-right mono-text text-muted">
                        ${isDir ? item.file_count.toLocaleString() + ' files' : '1 file'}
                    </td>
                </tr>
            `;
        }).join('');

        elements.diskBreakdownTbody.innerHTML = html;

        // Restore any currently expanded subfolders from memory cache
        if (state.expandedFolders.size > 0) {
            elements.diskBreakdownTbody.querySelectorAll('.disk-row-expandable.expanded[data-depth="1"]').forEach(row => {
                const path = row.getAttribute('data-path');
                if (path && state.subfolderCache.has(path)) {
                    renderSubfolderDOM(row, path, state.subfolderCache.get(path), getSafeRowId(path), 2);
                }
            });
        }
    }

    async function toggleSubfolderRow(parentRowEl, itemPath, depth = 1) {
        if (!parentRowEl || !itemPath) return;

        const rowId = getSafeRowId(itemPath);
        const isExpanded = parentRowEl.classList.contains('expanded');
        const chevronBtn = parentRowEl.querySelector('.disk-chevron-btn');
        const nextDepth = depth + 1;

        if (isExpanded) {
            // Collapse: Remove row and cleanup all child expanded paths
            parentRowEl.classList.remove('expanded');
            if (chevronBtn) chevronBtn.classList.remove('rotated');
            state.expandedFolders.delete(itemPath);
            const existingSubRow = document.getElementById(rowId);
            if (existingSubRow) {
                existingSubRow.querySelectorAll('.disk-row-expandable').forEach(r => {
                    const childPath = r.getAttribute('data-path');
                    if (childPath) state.expandedFolders.delete(childPath);
                });
                existingSubRow.remove();
            }
        } else {
            // Expand
            parentRowEl.classList.add('expanded');
            if (chevronBtn) chevronBtn.classList.add('rotated');
            state.expandedFolders.add(itemPath);

            // If already cached in memory, render instantly (0ms)
            if (state.subfolderCache.has(itemPath)) {
                const cachedData = state.subfolderCache.get(itemPath);
                renderSubfolderDOM(parentRowEl, itemPath, cachedData, rowId, nextDepth);
                return;
            }

            // Insert instant loading row
            const existingSubRow = document.getElementById(rowId);
            if (existingSubRow) existingSubRow.remove();

            const loadingRow = document.createElement('tr');
            loadingRow.className = `subfolder-nested-row depth-${nextDepth}`;
            loadingRow.id = rowId;
            loadingRow.innerHTML = `
                <td colspan="6" class="subfolder-nested-td">
                    <div class="subfolder-tree-box depth-box-${nextDepth}">
                        <div class="sub-loading-box">
                            <span class="spin" style="font-size: 1.1rem;">🔄</span>
                            <span>Đang quét các tệp & thư mục con cấp ${nextDepth} bên trong <code>${escapeHtml(itemPath)}</code>...</span>
                        </div>
                    </div>
                </td>
            `;
            parentRowEl.after(loadingRow);

            try {
                const res = await fetch(`/api/disk/sub-items?path=${encodeURIComponent(itemPath)}`);
                if (res.ok) {
                    const data = await res.json();
                    state.subfolderCache.set(itemPath, data);

                    // If user didn't collapse while loading
                    if (state.expandedFolders.has(itemPath)) {
                        renderSubfolderDOM(parentRowEl, itemPath, data, rowId, nextDepth);
                    }
                } else {
                    const loadingEl = document.getElementById(rowId);
                    if (loadingEl) {
                        loadingEl.innerHTML = `
                            <td colspan="6" class="subfolder-nested-td">
                                <div class="subfolder-tree-box depth-box-${nextDepth}">
                                    <div class="sub-error-box">⚠️ Không thể quét danh sách thư mục con của ${escapeHtml(itemPath)}.</div>
                                </div>
                            </td>
                        `;
                    }
                }
            } catch (err) {
                const loadingEl = document.getElementById(rowId);
                if (loadingEl) {
                    loadingEl.innerHTML = `
                        <td colspan="6" class="subfolder-nested-td">
                            <div class="subfolder-tree-box depth-box-${nextDepth}">
                                <div class="sub-error-box">⚠️ Lỗi kết nối máy chủ phân tích ổ đĩa.</div>
                            </div>
                        </td>
                    `;
                }
            }
        }
    }

    function renderSubfolderDOM(parentRowEl, itemPath, data, rowId, depth = 2) {
        const existing = document.getElementById(rowId);
        if (existing) existing.remove();

        const subRow = document.createElement('tr');
        subRow.className = `subfolder-nested-row depth-${depth}`;
        subRow.id = rowId;

        const depthConfig = {
            2: { label: 'CẤP 2 (Level 2)', color: 'var(--accent-lime)', border: 'rgba(194, 248, 59, 0.35)' },
            3: { label: 'CẤP 3 (Level 3)', color: '#38bdf8', border: 'rgba(56, 189, 248, 0.35)' },
            4: { label: 'CẤP 4 (Level 4)', color: '#c084fc', border: 'rgba(192, 132, 252, 0.35)' },
            5: { label: 'CẤP 5 (Level 5)', color: '#fb923c', border: 'rgba(251, 146, 60, 0.35)' },
        };
        const currentDepth = depthConfig[depth] || { label: `CẤP ${depth}`, color: '#f472b6', border: 'rgba(244, 114, 182, 0.35)' };

        if (data.status === 'permission_denied') {
            subRow.innerHTML = `
                <td colspan="6" class="subfolder-nested-td">
                    <div class="subfolder-tree-box depth-box-${depth}">
                        <div class="sub-error-box">
                            🔒 <strong>Quyền truy cập bị từ chối (${currentDepth.label}):</strong> ${escapeHtml(data.message || 'Thư mục được bảo vệ bởi Windows.')}
                        </div>
                    </div>
                </td>
            `;
            parentRowEl.after(subRow);
            return;
        }

        const items = data.items || [];
        if (items.length === 0) {
            subRow.innerHTML = `
                <td colspan="6" class="subfolder-nested-td">
                    <div class="subfolder-tree-box depth-box-${depth}">
                        <div class="subfolder-tree-header">
                            <div class="sub-header-left">
                                <span class="tree-branch-glyph" style="color:${currentDepth.color};">↳</span>
                                <span class="sub-parent-badge" style="color:${currentDepth.color};">${currentDepth.label}:</span>
                                <code class="sub-parent-path">📁 ${escapeHtml(data.parent_path || itemPath)}</code>
                            </div>
                            <div class="sub-header-right">
                                <span class="sub-stat-pill">0 Mục (Trống)</span>
                            </div>
                        </div>
                        <div class="text-muted text-center py-4" style="font-size: 0.82rem;">Thư mục này hiện không có tệp hoặc thư mục con nào.</div>
                    </div>
                </td>
            `;
            parentRowEl.after(subRow);
            return;
        }

        const rowsHtml = items.map((sub, idx) => {
            const isDir = sub.is_dir;
            const isExpanded = isDir && state.expandedFolders.has(sub.path);
            const badgeClass = isDir ? 'folder-badge' : 'file-badge';
            const expandableClass = isDir ? 'disk-row-expandable' : '';
            const expandedClass = isExpanded ? 'expanded' : '';
            const chevron = isDir
                ? `<button type="button" class="disk-chevron-btn ${isExpanded ? 'rotated' : ''}" title="Bấm để mở rộng tiếp cấp ${depth + 1}">▶</button>`
                : `<span class="disk-chevron-spacer"></span>`;
            const rowTitleHint = isDir ? `Bấm để mở rộng / thu gọn thư mục con (Cấp ${depth + 1})` : '';

            const iconSvg = isDir
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`
                : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

            const previewBtn = (!isDir && isFilePreviewable(sub.name || sub.path))
                ? `<button type="button" class="btn-preview-file ${getPreviewBadgeClass(sub.name || sub.path)}" data-preview-path="${escapeHtml(sub.path)}" title="Xem trực tiếp trên trình duyệt (Ảnh, Video, PDF, Code)">👁️ Xem</button>`
                : '';

            return `
                <tr class="sub-item-row ${expandableClass} ${expandedClass}" data-path="${escapeHtml(sub.path)}" data-depth="${depth}" title="${rowTitleHint}">
                    <td class="sub-idx-cell">.${idx + 1}</td>
                    <td>
                        <div class="sub-item-flex-cell">
                            <span class="sub-tree-connector" style="color:${currentDepth.color};">├─</span>
                            ${chevron}
                            <span class="sub-icon-badge ${badgeClass}">${iconSvg}</span>
                            <div class="sub-name-text-group">
                                <span class="sub-main-title">${escapeHtml(sub.name)}</span>
                                <span class="sub-path-text">${escapeHtml(sub.path)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span class="item-type-badge ${badgeClass}" style="font-size: 0.70rem; padding: 2px 8px;">${sub.type}</span>
                            ${previewBtn}
                        </div>
                    </td>
                    <td><strong class="mono-text" style="color: var(--text-white); font-size: 0.84rem;">${sub.size_formatted}</strong></td>
                    <td>
                        <div class="sub-bar-container">
                            <div class="sub-bar-track">
                                <div class="sub-bar-fill" style="width: ${Math.min(100, sub.percent_of_parent)}%; background: ${currentDepth.color};"></div>
                            </div>
                            <span class="sub-bar-text">${sub.percent_of_parent.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td class="text-right mono-text text-muted" style="font-size: 0.76rem;">
                        ${isDir ? (sub.file_count || 0).toLocaleString() + ' files' : '1 file'}
                    </td>
                </tr>
            `;
        }).join('');

        subRow.innerHTML = `
            <td colspan="6" class="subfolder-nested-td">
                <div class="subfolder-tree-box depth-box-${depth}">
                    <div class="subfolder-tree-header">
                        <div class="sub-header-left">
                            <span class="tree-branch-glyph" style="color:${currentDepth.color};">↳</span>
                            <span class="sub-parent-badge" style="color:${currentDepth.color};">${currentDepth.label}:</span>
                            <code class="sub-parent-path">📁 ${escapeHtml(data.parent_path)}</code>
                        </div>
                        <div class="sub-header-right">
                            <span class="sub-stat-pill">Dung lượng: <strong class="mono-text" style="color:#ffffff;">${data.total_size_formatted}</strong></span>
                            <span class="sub-stat-pill">Mục con: <strong class="mono-text" style="color:${currentDepth.color};">${data.item_count}</strong></span>
                            ${data.is_cached ? '<span class="sub-stat-pill pill-cached">⚡ Cached (0ms)</span>' : '<span class="sub-stat-pill">Fresh scan</span>'}
                        </div>
                    </div>
                    <div class="sub-table-container">
                        <table class="sub-tree-table">
                            <thead>
                                <tr>
                                    <th style="width: 45px;">#</th>
                                    <th>Tên File / Thư Mục Con (${currentDepth.label})</th>
                                    <th style="width: 110px;">Loại</th>
                                    <th style="width: 110px;">Dung Lượng</th>
                                    <th style="width: 160px;">% Thư Mục Cha</th>
                                    <th style="width: 110px;" class="text-right">Số Tệp</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rowsHtml}
                            </tbody>
                        </table>
                    </div>
                </div>
            </td>
        `;

        parentRowEl.after(subRow);

        // Recursively restore any sub-children if they were already expanded in state.expandedFolders
        subRow.querySelectorAll('.sub-item-row.disk-row-expandable.expanded').forEach(childRow => {
            const childPath = childRow.getAttribute('data-path');
            if (childPath && state.subfolderCache.has(childPath)) {
                renderSubfolderDOM(childRow, childPath, state.subfolderCache.get(childPath), getSafeRowId(childPath), depth + 1);
            }
        });
    }

    function round2(val) {
        return Math.round(val * 100) / 100;
    }

    function escapeHtml(str) {
        if (!str) return 'N/A';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // =========================================================================
    // Tab 4: Application Usage & Network Bandwidth Analytics Logic
    // =========================================================================
    async function fetchAppAnalytics(range = 'today', force = false) {
        state.appTimeRange = range;

        if (!force && state.appCache.has(range)) {
            renderAppAnalytics(state.appCache.get(range));
            return;
        }

        try {
            const res = await fetch(`/api/apps/analytics?range=${encodeURIComponent(range)}`);
            if (res.ok) {
                const data = await res.json();
                state.appCache.set(range, data);
                state.appAnalyticsData = data;
                renderAppAnalytics(data);
            }
        } catch (e) {
            console.error('Error fetching app analytics:', e);
        }

        fetchAppSummaryKPIs();
    }

    async function fetchAppSummaryKPIs() {
        try {
            const res = await fetch('/api/apps/summary');
            if (res.ok) {
                const kpi = await res.json();
                if (elements.appKpiWeekNet) elements.appKpiWeekNet.textContent = kpi.week_bandwidth_formatted;
                if (elements.appKpiMonthNet) elements.appKpiMonthNet.textContent = kpi.month_bandwidth_formatted;
            }
        } catch (e) {}
    }

    function renderAppAnalytics(data) {
        if (!data) return;

        // 1. Update 4 KPI Cards
        if (data.summary) {
            if (elements.appKpiTodayNet) elements.appKpiTodayNet.textContent = data.summary.total_bandwidth_formatted;
            if (elements.appKpiTodayDlUl) {
                elements.appKpiTodayDlUl.textContent = `↓ ${data.summary.total_download_formatted} • ↑ ${data.summary.total_upload_formatted}`;
            }
            if (elements.appKpiTodaySt) elements.appKpiTodaySt.textContent = data.summary.total_screen_time_formatted;
        }

        // 2. Update Trend Chart
        if (appTrendChart && data.trend_chart) {
            appTrendChart.data.labels = data.trend_chart.labels || [];
            appTrendChart.data.datasets[0].data = data.trend_chart.download_gb || [];
            appTrendChart.data.datasets[1].data = data.trend_chart.upload_gb || [];
            appTrendChart.update();
        }

        // 3. Update Share Donut Chart
        if (appShareChart && data.apps) {
            const top5 = data.apps.slice(0, 5);
            const otherTotal = data.apps.slice(5).reduce((acc, a) => acc + (a.total_bytes || 0), 0);
            const labels = top5.map(a => a.app_name);
            const values = top5.map(a => Math.round((a.total_bytes / (1024 * 1024)) * 10) / 10);
            if (otherTotal > 0) {
                labels.push('Other Apps');
                values.push(Math.round((otherTotal / (1024 * 1024)) * 10) / 10);
            }
            appShareChart.data.labels = labels;
            appShareChart.data.datasets[0].data = values;
            appShareChart.data.datasets[0].backgroundColor = [
                'rgba(194, 248, 59, 0.9)',
                'rgba(56, 189, 248, 0.9)',
                'rgba(52, 211, 153, 0.9)',
                'rgba(251, 191, 36, 0.9)',
                'rgba(167, 139, 250, 0.9)',
                'rgba(100, 116, 139, 0.5)',
            ];
            appShareChart.update();
        }

        // 4. Update Smart Insights Card
        if (elements.appInsightsSummary && data.apps && data.apps.length > 0) {
            const topApp = data.apps[0];
            const topCat = data.categories && data.categories[0] ? data.categories[0].category : 'General';
            const rangeText = state.appTimeRange === 'today' ? 'hôm nay' : (state.appTimeRange === '7d' ? 'trong 7 ngày qua' : 'trong 30 ngày qua');
            elements.appInsightsSummary.innerHTML = `Ứng dụng chiếm băng thông nhiều nhất ${rangeText} là <strong>${escapeHtml(topApp.app_name)}</strong> (${topApp.total_formatted}, chiếm ${topApp.percent_of_total}% tổng lưu lượng). Danh mục tiêu thụ hàng đầu là <strong>${escapeHtml(topCat)}</strong>.`;

            if (elements.appInsightsPills) {
                elements.appInsightsPills.innerHTML = `
                    <span class="copilot-chip">🏆 Top: ${escapeHtml(topApp.app_name)}</span>
                    <span class="copilot-chip">⏱️ Active: ${topApp.screen_time_formatted}</span>
                    <span class="copilot-chip">📊 Category: ${escapeHtml(topCat)}</span>
                `;
            }
        }

        // 5. Render Apps Table
        renderAppTable(data.apps || []);
    }

    function renderAppTable(apps) {
        if (!apps || !elements.appAnalyticsTbody) return;

        elements.appTableTotalCount.textContent = `${apps.length} Apps`;

        let list = [...apps];
        const q = state.appSearchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(a => (a.app_name && a.app_name.toLowerCase().includes(q)) || (a.exe_name && a.exe_name.toLowerCase().includes(q)) || (a.category && a.category.toLowerCase().includes(q)));
        }

        // Sorting Logic
        const sortKey = state.appSortKey || 'total_bytes';
        const isAsc = state.appSortOrder === 'asc';

        list.sort((a, b) => {
            let res = 0;
            if (sortKey === 'app_name') {
                res = (a.app_name || '').localeCompare(b.app_name || '');
            } else if (sortKey === 'category') {
                res = (a.category || '').localeCompare(b.category || '');
            } else if (sortKey === 'screen_time') {
                res = (a.screen_time_seconds || 0) - (b.screen_time_seconds || 0);
            } else if (sortKey === 'download') {
                res = (a.download_bytes || 0) - (b.download_bytes || 0);
            } else if (sortKey === 'upload') {
                res = (a.upload_bytes || 0) - (b.upload_bytes || 0);
            } else if (sortKey === 'percent') {
                res = (a.percent_of_total || 0) - (b.percent_of_total || 0);
            } else if (sortKey === 'rank') {
                res = (a.total_bytes || 0) - (b.total_bytes || 0);
            } else {
                // Default: total_bytes
                res = (a.total_bytes || 0) - (b.total_bytes || 0);
            }
            return isAsc ? res : -res;
        });

        // Update header UI sort indicators
        document.querySelectorAll('#app-breakdown-table th.sortable-th').forEach(th => {
            const k = th.getAttribute('data-sort');
            const iconSpan = th.querySelector('.sort-icon');
            if (k === sortKey) {
                th.classList.add('active-sort');
                th.classList.toggle('asc', isAsc);
                th.classList.toggle('desc', !isAsc);
                if (iconSpan) iconSpan.textContent = isAsc ? '▲' : '▼';
            } else {
                th.classList.remove('active-sort', 'asc', 'desc');
                if (iconSpan) iconSpan.textContent = '⇅';
            }
        });

        if (list.length === 0) {
            elements.appAnalyticsTbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center text-muted py-5">No matching applications found for "${escapeHtml(q)}".</td>
                </tr>
            `;
            return;
        }

        const getCatClass = (cat) => {
            const c = (cat || '').toLowerCase();
            if (c.includes('browser')) return 'cat-browser';
            if (c.includes('dev')) return 'cat-development';
            if (c.includes('social') || c.includes('chat')) return 'cat-social';
            if (c.includes('media')) return 'cat-media';
            if (c.includes('game') || c.includes('gaming')) return 'cat-gaming';
            if (c.includes('system')) return 'cat-system';
            return 'cat-other';
        };

        const html = list.map((app, idx) => {
            const catClass = getCatClass(app.category);
            return `
                <tr>
                    <td class="proc-pid" style="font-size: 0.84rem; font-weight: 700; color: var(--text-muted);">#${idx + 1}</td>
                    <td>
                        <div class="app-row-title-box">
                            <span class="app-icon-badge">${app.icon || '📦'}</span>
                            <div>
                                <div class="app-title-name">${escapeHtml(app.app_name)}</div>
                                <div class="app-title-exe">${escapeHtml(app.exe_name)}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="app-cat-badge ${catClass}">${escapeHtml(app.category)}</span>
                    </td>
                    <td>
                        <span class="app-time-badge">⏱️ ${app.screen_time_formatted}</span>
                    </td>
                    <td>
                        <span class="app-val-dl">↓ ${app.download_formatted}</span>
                    </td>
                    <td>
                        <span class="app-val-ul">↑ ${app.upload_formatted}</span>
                    </td>
                    <td>
                        <strong class="app-val-total">${app.total_formatted}</strong>
                    </td>
                    <td>
                        <div class="app-share-box">
                            <div class="app-share-track">
                                <div class="app-share-fill" style="width: ${Math.min(100, app.percent_of_total)}%;"></div>
                            </div>
                            <span class="app-share-pct">${app.percent_of_total.toFixed(1)}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        elements.appAnalyticsTbody.innerHTML = html;
    }

    // =========================================================================
    // Tab 5: Downloads Tracker & History Logic
    // =========================================================================
    function getCategoryBadgeClass(category) {
        const map = {
            'Document': 'dl-badge-document',
            'Image': 'dl-badge-image',
            'Video': 'dl-badge-video',
            'Audio': 'dl-badge-audio',
            'Archive': 'dl-badge-archive',
            'Executable': 'dl-badge-executable',
            'Code': 'dl-badge-code',
            'Downloading': 'dl-badge-downloading',
        };
        return map[category] || 'dl-badge-other';
    }

    function getCategoryColor(category) {
        const map = {
            'Document': '#38bdf8',
            'Image': '#c084fc',
            'Video': '#f472b6',
            'Audio': '#2dd4bf',
            'Archive': '#fb923c',
            'Executable': '#f87171',
            'Code': '#c2f83b',
            'Downloading': '#fbbf24',
        };
        return map[category] || '#94a3b8';
    }

    function getCategoryIcon(category) {
        switch (category) {
            case 'Document': return '📄';
            case 'Image': return '🖼️';
            case 'Video': return '🎬';
            case 'Audio': return '🎵';
            case 'Archive': return '📦';
            case 'Executable': return '⚙️';
            case 'Code': return '💻';
            case 'Downloading': return '⏳';
            default: return '📁';
        }
    }

    async function fetchDownloads(filter = 'today', force = false) {
        if (state.isDownloadsScanning) return;
        state.isDownloadsScanning = true;
        state.downloadsFilter = filter;

        if (elements.dlSpinIcon) elements.dlSpinIcon.classList.add('spin');
        if (elements.downloadsTbody && !state.downloadsData) {
            elements.downloadsTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-5">Scanning downloads directory for ${filter}... Please wait.</td>
                </tr>
            `;
        }

        try {
            const res = await fetch(`/api/downloads?filter=${encodeURIComponent(filter)}&force=${force}`);
            if (res.ok) {
                const data = await res.json();
                state.downloadsData = data;
                renderDownloadsView(data);
            } else {
                if (elements.downloadsTbody) {
                    elements.downloadsTbody.innerHTML = `
                        <tr>
                            <td colspan="6" class="text-center text-danger py-5">⚠️ Error loading downloads telemetry.</td>
                        </tr>
                    `;
                }
            }
        } catch (e) {
            console.error('Error fetching downloads:', e);
            if (elements.downloadsTbody) {
                elements.downloadsTbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="text-center text-danger py-5">⚠️ Network connection error.</td>
                    </tr>
                `;
            }
        } finally {
            state.isDownloadsScanning = false;
            if (elements.dlSpinIcon) elements.dlSpinIcon.classList.remove('spin');
        }
    }

    function renderDownloadsView(data) {
        if (!data) return;

        // 1. Filter pill label update
        const filterLabels = {
            'today': 'Today',
            'week': 'Past 7 Days',
            'month': 'Past 30 Days',
            'all': 'All Time'
        };
        const activeLabel = filterLabels[data.filter_applied] || data.filter_applied;
        if (elements.dlKpiFilterTag) elements.dlKpiFilterTag.textContent = activeLabel;
        if (elements.dlActiveFilterLabel) elements.dlActiveFilterLabel.textContent = `Filter: ${activeLabel}`;

        // 2. Card 1: Total Files
        if (elements.dlKpiTotalFiles) {
            elements.dlKpiTotalFiles.innerHTML = `${data.total_files} <span class="unit">Files</span>`;
        }
        if (elements.dlKpiDirText) {
            elements.dlKpiDirText.textContent = `📁 ${data.downloads_dir || '~/Downloads'}`;
            elements.dlKpiDirText.title = data.downloads_dir || '';
        }
        if (elements.dlKpiScanTime) {
            elements.dlKpiScanTime.textContent = `Scan: ${data.scan_duration_sec}s`;
        }

        // 3. Card 2: Total Storage
        if (elements.dlKpiTotalSize) {
            elements.dlKpiTotalSize.innerHTML = `${data.total_size_formatted}`;
        }
        if (elements.dlKpiAvgSize) {
            const avgBytes = data.total_files > 0 ? (data.total_size_bytes / data.total_files) : 0;
            const avgFormatted = avgBytes >= (1024 * 1024) 
                ? `${(avgBytes / (1024 * 1024)).toFixed(1)} MB`
                : `${(avgBytes / 1024).toFixed(0)} KB`;
            elements.dlKpiAvgSize.textContent = `Avg: ${avgFormatted} / file`;
        }
        if (elements.dlKpiCacheStatus) {
            elements.dlKpiCacheStatus.textContent = data.is_cached ? `Cached (${data.cache_age_sec}s ago)` : 'Fresh scan';
        }

        // 4. Card 3: Top Category
        const topCat = data.top_category || 'None';
        const topStats = (data.category_breakdown && data.category_breakdown[topCat]) || { count: 0, size_formatted: '0 B', percent_of_total: 0 };
        
        if (elements.dlKpiTopCategoryName) {
            elements.dlKpiTopCategoryName.textContent = topCat;
        }
        if (elements.dlKpiTopCategoryBadge) {
            elements.dlKpiTopCategoryBadge.textContent = topCat !== 'None' ? `${topStats.count} items` : '--';
            elements.dlKpiTopCategoryBadge.className = `chip-status ${topCat !== 'None' ? 'chip-warn' : 'chip-normal'}`;
        }
        if (elements.dlKpiTopCategoryMeta) {
            elements.dlKpiTopCategoryMeta.textContent = topCat !== 'None' ? `${topStats.count} files • ${topStats.size_formatted}` : '0 files • 0 MB';
        }
        if (elements.dlKpiTopCategoryPct) {
            elements.dlKpiTopCategoryPct.textContent = topCat !== 'None' ? `${topStats.percent_of_total}% of storage` : '0% of total';
        }

        // 5. Render Breakdown Bar & Legend
        renderCategoryBreakdown(data.category_breakdown, data.total_size_bytes);

        // 6. Render Table
        renderDownloadsTable(data.files || []);
    }

    function renderCategoryBreakdown(breakdown, totalSize) {
        if (!elements.dlCategoryBarTrack || !elements.dlCategoryLegend) return;

        const categories = breakdown ? Object.keys(breakdown) : [];
        if (categories.length === 0 || totalSize === 0) {
            elements.dlCategoryBarTrack.innerHTML = '<div class="dl-bar-empty">No files found for this time range</div>';
            elements.dlCategoryLegend.innerHTML = '<span class="text-muted" style="font-size:0.75rem;">No category breakdown available</span>';
            return;
        }

        // 1. Build segmented bar HTML
        const barHtml = categories.map(cat => {
            const stat = breakdown[cat];
            const pct = stat.percent_of_total || 0;
            if (pct <= 0) return '';
            const colorClass = `bg-cat-${cat.toLowerCase()}`;
            return `<div class="dl-bar-segment ${colorClass}" style="width: ${pct}%;" title="${cat}: ${stat.count} files (${stat.size_formatted} - ${pct}%)"></div>`;
        }).join('');

        elements.dlCategoryBarTrack.innerHTML = barHtml || '<div class="dl-bar-empty">No files found</div>';

        // 2. Build legend chips
        const legendHtml = categories.map(cat => {
            const stat = breakdown[cat];
            const color = getCategoryColor(cat);
            const icon = getCategoryIcon(cat);
            return `
                <div class="dl-legend-chip" data-category="${cat}" title="Filter by ${cat}">
                    <span class="dl-legend-dot" style="background: ${color};"></span>
                    <span class="dl-legend-name">${icon} ${cat}</span>
                    <span class="dl-legend-meta">(${stat.count} • ${stat.size_formatted})</span>
                </div>
            `;
        }).join('');

        elements.dlCategoryLegend.innerHTML = legendHtml;

        // Attach click on legend chips to filter
        elements.dlCategoryLegend.querySelectorAll('.dl-legend-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const targetCat = chip.getAttribute('data-category');
                if (elements.dlTypeFilter) {
                    elements.dlTypeFilter.value = targetCat;
                    state.downloadsTypeFilter = targetCat;
                    if (state.downloadsData) renderDownloadsTable(state.downloadsData.files);
                }
            });
        });
    }

    function renderDownloadsTable(files) {
        if (!elements.downloadsTbody) return;

        let list = [...(files || [])];

        // 1. Filter by Category
        if (state.downloadsTypeFilter && state.downloadsTypeFilter !== 'all') {
            list = list.filter(f => f.file_type === state.downloadsTypeFilter);
        }

        // 2. Filter by Search Query
        const q = state.downloadsSearchQuery.trim().toLowerCase();
        if (q) {
            list = list.filter(f => 
                (f.file_name && f.file_name.toLowerCase().includes(q)) ||
                (f.extension && f.extension.toLowerCase().includes(q)) ||
                (f.file_type && f.file_type.toLowerCase().includes(q))
            );
        }

        if (elements.dlTableCountBadge) {
            elements.dlTableCountBadge.textContent = `${list.length} Files`;
        }

        if (list.length === 0) {
            elements.downloadsTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-5">
                        No downloaded files matching current filter criteria.
                    </td>
                </tr>
            `;
            return;
        }

        const html = list.map((file, idx) => {
            const badgeClass = getCategoryBadgeClass(file.file_type);
            const icon = getCategoryIcon(file.file_type);
            return `
                <tr>
                    <td class="proc-pid">#${idx + 1}</td>
                    <td>
                        <div class="dl-file-name-cell">
                            <span class="dl-file-icon-box">${icon}</span>
                            <div class="dl-file-text-group">
                                <span class="dl-file-title" title="${escapeHtml(file.file_name)}">${escapeHtml(file.file_name)}</span>
                                <span class="dl-file-subpath" title="${escapeHtml(file.file_path)}">${escapeHtml(file.file_path)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="dl-badge ${badgeClass}">${file.file_type}</span>
                    </td>
                    <td>
                        <span class="dl-size-text">${file.file_size_formatted}</span>
                    </td>
                    <td>
                        <div class="dl-time-cell">
                            <span class="dl-time-relative">${file.time_ago}</span>
                            <span class="dl-time-exact">${file.downloaded_at_formatted}</span>
                        </div>
                    </td>
                    <td class="text-right" style="white-space:nowrap;">
                        <button class="btn-preview-file ${getPreviewBadgeClass(file.file_name || file.file_path)}" data-preview-path="${escapeHtml(file.file_path)}" title="Xem trực tiếp trên trình duyệt (Ảnh, Video, PDF, Code)" style="margin-right: 6px;">
                            👁️ Xem
                        </button>
                        <button class="btn-open-in-folder" data-path="${escapeHtml(file.file_path)}" title="Open containing folder in Windows Explorer">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                            <span>Open Folder</span>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        elements.downloadsTbody.innerHTML = html;
    }

    async function openFileInExplorer(filePath) {
        if (!filePath) return;
        try {
            const res = await fetch('/api/downloads/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath })
            });
            const data = await res.json();
            if (data.status === 'success') {
                showActionToast('Opened folder in Windows Explorer', false);
            } else {
                showActionToast(data.message || 'Could not open folder', true);
            }
        } catch (e) {
            showActionToast('Failed to connect to server', true);
        }
    }

    async function openDownloadsFolder() {
        try {
            const res = await fetch('/api/downloads/open-downloads-dir', {
                method: 'POST'
            });
            const data = await res.json();
            if (data.status === 'success') {
                showActionToast('Opened Downloads folder in File Explorer', false);
            } else {
                showActionToast(data.message || 'Could not open Downloads folder', true);
            }
        } catch (e) {
            showActionToast('Failed to connect to server', true);
        }
    }

    // =========================================================================
    // Tab 6: Resource Threshold Alerts & Webhook Notifications Logic
    // =========================================================================
    async function fetchAlertConfig() {
        try {
            const res = await fetch('/api/alerts/config');
            if (res.ok) {
                const data = await res.json();
                state.alertConfig = data.config;
                state.alertHistory = data.history || [];
                populateAlertForm(data.config);
                renderAlertHistory(data.history || []);
            }
        } catch (e) {
            console.error('Error fetching alert config:', e);
        }
    }

    function populateAlertForm(cfg) {
        if (!cfg) return;

        if (elements.alertMasterToggle) elements.alertMasterToggle.checked = cfg.enabled !== false;
        if (elements.alertDiscordEnable) elements.alertDiscordEnable.checked = !!cfg.discord_enabled;
        if (elements.alertDiscordUrl) elements.alertDiscordUrl.value = cfg.discord_webhook_url || '';
        if (elements.alertTelegramEnable) elements.alertTelegramEnable.checked = !!cfg.telegram_enabled;
        if (elements.alertTelegramToken) elements.alertTelegramToken.value = cfg.telegram_bot_token || '';
        if (elements.alertTelegramChatId) elements.alertTelegramChatId.value = cfg.telegram_chat_id || '';

        const cpuThresh = cfg.cpu_threshold !== undefined ? cfg.cpu_threshold : 90;
        if (elements.alertCpuEnable) elements.alertCpuEnable.checked = cfg.cpu_enabled !== false;
        if (elements.alertCpuInput) elements.alertCpuInput.value = cpuThresh;
        if (elements.alertCpuSlider) elements.alertCpuSlider.value = cpuThresh;
        if (elements.alertCpuSustained) elements.alertCpuSustained.value = cfg.cpu_sustained_sec || 30;
        if (elements.meterLimitCpu) elements.meterLimitCpu.textContent = `${cpuThresh}%`;
        if (elements.meterMarkerCpu) elements.meterMarkerCpu.style.left = `${Math.min(100, Math.max(0, cpuThresh))}%`;

        const ramThresh = cfg.ram_threshold !== undefined ? cfg.ram_threshold : 85;
        if (elements.alertRamEnable) elements.alertRamEnable.checked = cfg.ram_enabled !== false;
        if (elements.alertRamInput) elements.alertRamInput.value = ramThresh;
        if (elements.alertRamSlider) elements.alertRamSlider.value = ramThresh;
        if (elements.meterLimitRam) elements.meterLimitRam.textContent = `${ramThresh}%`;
        if (elements.meterMarkerRam) elements.meterMarkerRam.style.left = `${Math.min(100, Math.max(0, ramThresh))}%`;

        const diskThresh = cfg.disk_c_free_min_gb !== undefined ? cfg.disk_c_free_min_gb : 5.0;
        if (elements.alertDiskEnable) elements.alertDiskEnable.checked = cfg.disk_enabled !== false;
        if (elements.alertDiskInput) elements.alertDiskInput.value = diskThresh;
        if (elements.alertDiskSlider) elements.alertDiskSlider.value = diskThresh;
        if (elements.meterLimitDisk) elements.meterLimitDisk.textContent = `${diskThresh} GB`;

        const cooldownMin = cfg.cooldown_minutes || 10;
        if (elements.alertCooldownInput) elements.alertCooldownInput.value = cooldownMin;
        if (elements.alertBadgeCooldownMin) elements.alertBadgeCooldownMin.textContent = `${cooldownMin}m`;

        // Update status pill
        if (elements.alertEngineStatusPill && elements.alertEngineStatusText) {
            if (cfg.enabled !== false) {
                elements.alertEngineStatusPill.className = 'alert-engine-status-pill';
                elements.alertEngineStatusText.textContent = 'Engine: Active (Monitoring)';
            } else {
                elements.alertEngineStatusPill.className = 'alert-engine-status-pill disabled';
                elements.alertEngineStatusText.textContent = 'Engine: Disabled';
            }
        }
    }

    async function saveAlertConfig() {
        if (state.isSavingAlert) return;
        state.isSavingAlert = true;

        const payload = {
            enabled: elements.alertMasterToggle ? elements.alertMasterToggle.checked : true,
            discord_enabled: elements.alertDiscordEnable ? elements.alertDiscordEnable.checked : false,
            discord_webhook_url: elements.alertDiscordUrl ? elements.alertDiscordUrl.value.trim() : '',
            telegram_enabled: elements.alertTelegramEnable ? elements.alertTelegramEnable.checked : false,
            telegram_bot_token: elements.alertTelegramToken ? elements.alertTelegramToken.value.trim() : '',
            telegram_chat_id: elements.alertTelegramChatId ? elements.alertTelegramChatId.value.trim() : '',
            cpu_enabled: elements.alertCpuEnable ? elements.alertCpuEnable.checked : true,
            cpu_threshold: elements.alertCpuInput ? parseFloat(elements.alertCpuInput.value) : 90,
            cpu_sustained_sec: elements.alertCpuSustained ? parseInt(elements.alertCpuSustained.value, 10) : 30,
            ram_enabled: elements.alertRamEnable ? elements.alertRamEnable.checked : true,
            ram_threshold: elements.alertRamInput ? parseFloat(elements.alertRamInput.value) : 85,
            disk_enabled: elements.alertDiskEnable ? elements.alertDiskEnable.checked : true,
            disk_c_free_min_gb: elements.alertDiskInput ? parseFloat(elements.alertDiskInput.value) : 5.0,
            cooldown_minutes: elements.alertCooldownInput ? parseInt(elements.alertCooldownInput.value, 10) : 10,
        };

        try {
            const res = await fetch('/api/alerts/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                state.alertConfig = data.config;
                populateAlertForm(data.config);
                showActionToast(data.message || 'Cấu hình cảnh báo đã lưu thành công!', false);
            } else {
                showActionToast('Lỗi khi lưu cấu hình cảnh báo', true);
            }
        } catch (e) {
            console.error('Error saving alert config:', e);
            showActionToast('Lỗi kết nối tới máy chủ', true);
        } finally {
            state.isSavingAlert = false;
        }
    }

    async function sendTestAlert() {
        if (state.isTestingAlert) return;
        state.isTestingAlert = true;

        if (elements.iconTestAlert) elements.iconTestAlert.classList.add('spin');
        if (elements.textTestAlert) elements.textTestAlert.textContent = 'Testing...';

        const payload = {
            discord_webhook_url: elements.alertDiscordUrl ? elements.alertDiscordUrl.value.trim() : '',
            telegram_bot_token: elements.alertTelegramToken ? elements.alertTelegramToken.value.trim() : '',
            telegram_chat_id: elements.alertTelegramChatId ? elements.alertTelegramChatId.value.trim() : '',
        };

        try {
            const res = await fetch('/api/alerts/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                const data = await res.json();
                const dSuccess = data.result?.discord?.success;
                const dAttempt = data.result?.discord?.attempted;
                const dErr = data.result?.discord?.error;

                const tgSuccess = data.result?.telegram?.success;
                const tgAttempt = data.result?.telegram?.attempted;
                const tgErr = data.result?.telegram?.error;

                if (dSuccess && tgSuccess) {
                    showActionToast('Đã gửi thông báo test thành công tới Discord & Telegram!', false);
                } else if (dSuccess) {
                    showActionToast('Đã gửi thông báo test thành công tới Discord Webhook!', false);
                } else if (tgSuccess) {
                    showActionToast('Đã gửi thông báo test thành công tới Telegram Bot!', false);
                } else if (!dAttempt && !tgAttempt) {
                    showActionToast('Vui lòng nhập URL Discord Webhook hoặc Token Telegram Bot để kiểm tra!', true);
                } else {
                    const errMsg = dErr || tgErr || 'Kiểm tra lại Webhook URL hoặc Bot Token';
                    showActionToast(`Lỗi test: ${errMsg}`, true);
                }

                // Refresh history table
                const histRes = await fetch('/api/alerts/history');
                if (histRes.ok) {
                    const histData = await histRes.json();
                    state.alertHistory = histData.history || [];
                    renderAlertHistory(state.alertHistory);
                }
            } else {
                showActionToast('Lỗi gửi thông báo kiểm tra', true);
            }
        } catch (e) {
            console.error('Error sending test alert:', e);
            showActionToast('Lỗi kết nối tới máy chủ', true);
        } finally {
            state.isTestingAlert = false;
            if (elements.iconTestAlert) elements.iconTestAlert.classList.remove('spin');
            if (elements.textTestAlert) elements.textTestAlert.textContent = 'Test Webhook';
        }
    }

    function renderAlertGauges(metrics) {
        if (!metrics) return;

        // 1. CPU Gauge
        if (elements.meterCurrCpu && metrics.cpu) {
            const cpuVal = metrics.cpu.overall_percent || 0;
            const cpuLimit = (state.alertConfig && state.alertConfig.cpu_threshold) || 90;
            elements.meterCurrCpu.textContent = `${cpuVal.toFixed(1)}%`;
            if (elements.meterBarCpu) {
                elements.meterBarCpu.style.width = `${Math.min(100, cpuVal)}%`;
                elements.meterBarCpu.className = `meter-progress-bar ${cpuVal >= cpuLimit ? 'bg-danger' : (cpuVal >= cpuLimit - 10 ? 'bg-warn' : 'bg-lime')}`;
            }
            if (elements.meterBadgeCpu) {
                if (cpuVal >= cpuLimit) {
                    elements.meterBadgeCpu.textContent = 'OVER LIMIT';
                    elements.meterBadgeCpu.className = 'chip-status chip-alert';
                } else if (cpuVal >= cpuLimit - 10) {
                    elements.meterBadgeCpu.textContent = 'NEAR LIMIT';
                    elements.meterBadgeCpu.className = 'chip-status chip-warn';
                } else {
                    elements.meterBadgeCpu.textContent = 'SAFE';
                    elements.meterBadgeCpu.className = 'chip-status chip-normal';
                }
            }
        }

        // 2. RAM Gauge
        if (elements.meterCurrRam && metrics.memory && metrics.memory.ram) {
            const ramVal = metrics.memory.ram.percent || 0;
            const ramLimit = (state.alertConfig && state.alertConfig.ram_threshold) || 85;
            elements.meterCurrRam.textContent = `${ramVal.toFixed(1)}%`;
            if (elements.meterBarRam) {
                elements.meterBarRam.style.width = `${Math.min(100, ramVal)}%`;
                elements.meterBarRam.className = `meter-progress-bar ${ramVal >= ramLimit ? 'bg-danger' : (ramVal >= ramLimit - 10 ? 'bg-warn' : 'bg-sky')}`;
            }
            if (elements.meterBadgeRam) {
                if (ramVal >= ramLimit) {
                    elements.meterBadgeRam.textContent = 'OVER LIMIT';
                    elements.meterBadgeRam.className = 'chip-status chip-alert';
                } else if (ramVal >= ramLimit - 10) {
                    elements.meterBadgeRam.textContent = 'NEAR LIMIT';
                    elements.meterBadgeRam.className = 'chip-status chip-warn';
                } else {
                    elements.meterBadgeRam.textContent = 'SAFE';
                    elements.meterBadgeRam.className = 'chip-status chip-normal';
                }
            }
        }

        // 3. Disk C Gauge
        if (elements.meterCurrDisk && metrics.disk && metrics.disk.partitions) {
            let driveC = metrics.disk.partitions.find(p => (p.mountpoint || '').toUpperCase().startsWith('C:')) || metrics.disk.partitions[0];
            if (driveC) {
                const freeGb = driveC.free_gb || 0;
                const minFreeGb = (state.alertConfig && state.alertConfig.disk_c_free_min_gb) || 5.0;
                elements.meterCurrDisk.textContent = `${freeGb.toFixed(1)} GB`;
                if (elements.meterBarDisk) {
                    const usedPct = driveC.percent || 0;
                    elements.meterBarDisk.style.width = `${Math.min(100, 100 - usedPct)}%`;
                    elements.meterBarDisk.className = `meter-progress-bar ${freeGb <= minFreeGb ? 'bg-danger' : 'bg-emerald'}`;
                }
                if (elements.meterBadgeDisk) {
                    if (freeGb <= minFreeGb) {
                        elements.meterBadgeDisk.textContent = 'LOW SPACE';
                        elements.meterBadgeDisk.className = 'chip-status chip-alert';
                    } else {
                        elements.meterBadgeDisk.textContent = 'SAFE';
                        elements.meterBadgeDisk.className = 'chip-status chip-normal';
                    }
                }
            }
        }
    }

    function switchAlertSubTab(subTab) {
        state.alertActiveSubTab = subTab;
        if (elements.subnavAlertSettings) {
            elements.subnavAlertSettings.classList.toggle('active', subTab === 'settings');
        }
        if (elements.subnavAlertLogs) {
            elements.subnavAlertLogs.classList.toggle('active', subTab === 'logs');
        }
        if (elements.alertSubviewSettings) {
            elements.alertSubviewSettings.classList.toggle('hidden', subTab !== 'settings');
        }
        if (elements.alertSubviewLogs) {
            elements.alertSubviewLogs.classList.toggle('hidden', subTab !== 'logs');
        }
        if (subTab === 'logs') {
            renderAlertHistory(state.alertHistory);
        }
    }

    async function refreshAlertLogs() {
        if (elements.iconRefreshAlertLogs) elements.iconRefreshAlertLogs.classList.add('spin');
        try {
            const res = await fetch('/api/alerts/history');
            if (res.ok) {
                const data = await res.json();
                state.alertHistory = data.history || [];
                renderAlertHistory(state.alertHistory);
                showActionToast('Đã làm mới nhật ký cảnh báo', false);
            }
        } catch (e) {
            console.error('Error refreshing alert history:', e);
        } finally {
            if (elements.iconRefreshAlertLogs) {
                setTimeout(() => elements.iconRefreshAlertLogs.classList.remove('spin'), 400);
            }
        }
    }

    async function clearAlertHistory() {
        if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử thông báo cảnh báo không?')) {
            return;
        }
        try {
            const res = await fetch('/api/alerts/clear-history', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                state.alertHistory = [];
                renderAlertHistory([]);
                showActionToast(data.message || 'Đã xóa toàn bộ lịch sử cảnh báo', false);
            }
        } catch (e) {
            console.error('Error clearing alert history:', e);
            showActionToast('Lỗi khi xóa lịch sử cảnh báo', true);
        }
    }

    function renderAlertHistory(history) {
        const rawHistory = history || [];

        // 1. Compute and Render Summary KPI Statistics
        const totalAlerts = rawHistory.length;
        const lastSentTime = rawHistory.length > 0 ? (rawHistory[0].formatted_time || rawHistory[0].timestamp || 'Recently') : 'Never';
        const cooldownMin = (state.alertConfig && state.alertConfig.cooldown_minutes) || 10;

        if (elements.logKpiTotalCount) elements.logKpiTotalCount.innerHTML = `${totalAlerts} <span class="unit">Alerts</span>`;
        if (elements.logKpiLastSent) elements.logKpiLastSent.textContent = `Last: ${lastSentTime}`;
        if (elements.logKpiCooldownText) elements.logKpiCooldownText.textContent = `⏱️ ${cooldownMin}m Cooldown`;

        // Severity breakdown
        const critCount = rawHistory.filter(i => i.level === 'CRITICAL').length;
        const warnCount = rawHistory.filter(i => i.level === 'WARNING').length;
        const testCount = rawHistory.filter(i => i.type === 'TEST').length;

        if (elements.logKpiCriticalBadge) elements.logKpiCriticalBadge.textContent = `${critCount} Critical`;
        if (elements.logKpiCriticalCount) elements.logKpiCriticalCount.innerHTML = `${critCount} <span class="unit">Events</span>`;
        if (elements.logKpiWarnCount) elements.logKpiWarnCount.textContent = `⚠️ ${warnCount} Warnings`;
        if (elements.logKpiTestCount) elements.logKpiTestCount.textContent = `🧪 ${testCount} Tests`;

        // Delivery success stats
        let dAttempts = 0, dSuccess = 0;
        let tAttempts = 0, tSuccess = 0;

        rawHistory.forEach(item => {
            if (item.discord?.attempted) {
                dAttempts++;
                if (item.discord.success) dSuccess++;
            }
            if (item.telegram?.attempted) {
                tAttempts++;
                if (item.telegram.success) tSuccess++;
            }
        });

        const totalAttempts = dAttempts + tAttempts;
        const totalSuccess = dSuccess + tSuccess;
        const successRate = totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 100;

        if (elements.logKpiDeliverySuccessRate) elements.logKpiDeliverySuccessRate.innerHTML = `${successRate}<span class="unit">%</span>`;
        if (elements.logKpiDeliveryPctBadge) {
            elements.logKpiDeliveryPctBadge.textContent = `${successRate}%`;
            elements.logKpiDeliveryPctBadge.className = `chip-status ${successRate >= 90 ? 'chip-normal' : (successRate >= 70 ? 'chip-warn' : 'chip-alert')}`;
        }
        if (elements.logKpiDiscordDelivered) elements.logKpiDiscordDelivered.textContent = `🎮 Discord: ${dSuccess}/${dAttempts}`;
        if (elements.logKpiTgDelivered) elements.logKpiTgDelivered.textContent = `✈️ TG: ${tSuccess}/${tAttempts}`;

        // Top triggered resource
        const resourceCounts = {};
        rawHistory.forEach(item => {
            if (item.type && item.type !== 'TEST') {
                resourceCounts[item.type] = (resourceCounts[item.type] || 0) + 1;
            }
        });

        let topResType = 'None';
        let topResCount = 0;
        for (const [res, count] of Object.entries(resourceCounts)) {
            if (count > topResCount) {
                topResType = res;
                topResCount = count;
            }
        }

        const topResName = topResType === 'CPU' ? '⚡ CPU Load' : (topResType === 'RAM' ? '💾 RAM Memory' : (topResType === 'DISK' ? '💽 Disk (C:)' : (testCount > 0 ? '🧪 Test Webhook' : 'None')));
        const topResPct = totalAlerts > 0 ? Math.round((topResCount / totalAlerts) * 100) : 0;

        if (elements.logKpiTopResourceBadge) elements.logKpiTopResourceBadge.textContent = topResType !== 'None' ? topResType : 'Clean';
        if (elements.logKpiTopResourceName) elements.logKpiTopResourceName.innerHTML = `${escapeHtml(topResName)} <span class="unit">${topResCount}x</span>`;
        if (elements.logKpiTopResourcePeak) elements.logKpiTopResourcePeak.textContent = topResCount > 0 ? `Triggered ${topResCount} times` : 'Peak: --';
        if (elements.logKpiTopResourcePct) elements.logKpiTopResourcePct.textContent = `${topResPct}% of alerts`;

        // Update Subnav and Card Header Badges
        if (elements.subnavAlertLogsBadge) elements.subnavAlertLogsBadge.textContent = `${totalAlerts}`;
        if (elements.alertHistoryCountBadge) elements.alertHistoryCountBadge.textContent = `${totalAlerts} Alerts`;

        // Update Pill Counts
        const cpuCount = rawHistory.filter(i => (i.type || '').toUpperCase() === 'CPU').length;
        const ramCount = rawHistory.filter(i => (i.type || '').toUpperCase() === 'RAM').length;
        const diskCount = rawHistory.filter(i => (i.type || '').toUpperCase() === 'DISK').length;

        if (elements.pillCountAll) elements.pillCountAll.textContent = `(${totalAlerts})`;
        if (elements.pillCountCpu) elements.pillCountCpu.textContent = `(${cpuCount})`;
        if (elements.pillCountRam) elements.pillCountRam.textContent = `(${ramCount})`;
        if (elements.pillCountDisk) elements.pillCountDisk.textContent = `(${diskCount})`;
        if (elements.pillCountTest) elements.pillCountTest.textContent = `(${testCount})`;

        if (!elements.alertsHistoryTbody) return;

        // 2. Apply Filters (Type, Channel, Search)
        let filtered = rawHistory;

        // Filter by Type
        if (state.alertLogsTypeFilter && state.alertLogsTypeFilter !== 'all') {
            filtered = filtered.filter(item => (item.type || '').toUpperCase() === state.alertLogsTypeFilter.toUpperCase());
        }

        // Filter by Channel
        if (state.alertLogsChannelFilter === 'discord') {
            filtered = filtered.filter(item => item.discord?.attempted);
        } else if (state.alertLogsChannelFilter === 'telegram') {
            filtered = filtered.filter(item => item.telegram?.attempted);
        }

        // Filter by Search Query
        const q = (state.alertLogsSearchQuery || '').trim().toLowerCase();
        if (q) {
            filtered = filtered.filter(item => 
                (item.resource && item.resource.toLowerCase().includes(q)) ||
                (item.current_value && String(item.current_value).toLowerCase().includes(q)) ||
                (item.type && item.type.toLowerCase().includes(q)) ||
                (item.extra_info && item.extra_info.toLowerCase().includes(q)) ||
                (item.formatted_time && item.formatted_time.toLowerCase().includes(q)) ||
                (item.top_processes && item.top_processes.some(p => p.name && p.name.toLowerCase().includes(q)))
            );
        }

        if (filtered.length === 0) {
            elements.alertsHistoryTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-muted py-5" style="font-size: 0.85rem;">
                        <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                            <span style="font-size: 1.6rem; opacity:0.6;">🔔</span>
                            <span>${rawHistory.length === 0 ? 'Chưa có thông báo cảnh báo nào được gửi.' : 'Không tìm thấy nhật ký nào phù hợp với bộ lọc hiện tại.'}</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        const html = filtered.map((item, idx) => {
            const rowBorderClass = item.level === 'CRITICAL' ? 'row-critical' : (item.level === 'WARNING' ? 'row-warning' : 'row-info');
            const badgeTypeClass = (item.type === 'CPU' ? 'badge-cpu' : (item.type === 'RAM' ? 'badge-ram' : (item.type === 'DISK' ? 'badge-disk' : 'badge-test')));
            const typeIcon = item.type === 'CPU' ? '⚡' : (item.type === 'RAM' ? '💾' : (item.type === 'DISK' ? '💽' : '🧪'));

            // Top consuming processes chips
            let procChipsHtml = '';
            if (item.top_processes && item.top_processes.length > 0) {
                const chips = item.top_processes.slice(0, 3).map(p => {
                    const procName = p.name || 'proc';
                    const metricStr = p.cpu_percent !== undefined ? `${p.cpu_percent}%` : (p.memory_mb ? `${p.memory_mb} MB` : '');
                    return `<span class="log-proc-chip" title="${escapeHtml(procName)} (${metricStr})"><strong>${escapeHtml(procName)}</strong> <span class="chip-metric">${metricStr}</span></span>`;
                }).join('');
                procChipsHtml = `<div class="log-procs-chips">${chips}</div>`;
            }

            // Discord delivery badge
            let discordBadge = '<span class="delivery-pill disabled">Disabled</span>';
            if (item.discord?.attempted) {
                discordBadge = item.discord.success 
                    ? '<span class="delivery-pill success">✓ 204 OK</span>'
                    : `<div class="channel-delivery-cell"><span class="delivery-pill failed" title="${escapeHtml(item.discord.error || 'Failed')}">✗ Failed</span><span class="delivery-err-text" title="${escapeHtml(item.discord.error || '')}">${escapeHtml(item.discord.error || 'Error')}</span></div>`;
            }

            // Telegram delivery badge
            let tgBadge = '<span class="delivery-pill disabled">Disabled</span>';
            if (item.telegram?.attempted) {
                tgBadge = item.telegram.success 
                    ? '<span class="delivery-pill success">✓ 200 OK</span>'
                    : `<div class="channel-delivery-cell"><span class="delivery-pill failed" title="${escapeHtml(item.telegram.error || 'Failed')}">✗ Failed</span><span class="delivery-err-text" title="${escapeHtml(item.telegram.error || '')}">${escapeHtml(item.telegram.error || 'Error')}</span></div>`;
            }

            return `
                <tr class="alert-log-row ${rowBorderClass}">
                    <td class="proc-pid">#${idx + 1}</td>
                    <td>
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span class="mono-text" style="font-size:0.78rem; font-weight:700; color:var(--text-white);">${item.formatted_time || item.timestamp}</span>
                            <span class="text-muted" style="font-size:0.68rem;">${item.hostname || 'Host PC'}</span>
                        </div>
                    </td>
                    <td>
                        <div class="log-type-cell">
                            <span class="log-type-badge ${badgeTypeClass}">${typeIcon} ${item.type}</span>
                            <span class="chip-status ${item.level === 'CRITICAL' ? 'chip-alert' : (item.level === 'WARNING' ? 'chip-warn' : 'chip-normal')}" style="font-size:0.65rem; padding:1px 5px; width:fit-content;">${item.level}</span>
                        </div>
                    </td>
                    <td>
                        <div class="log-diag-box">
                            <div class="log-diag-header">
                                <span class="log-diag-title">${escapeHtml(item.resource || '')}</span>
                                <span class="log-diag-val">${escapeHtml(item.current_value || '')} (Ngưỡng: ${escapeHtml(item.threshold_value || '')})</span>
                            </div>
                            ${item.extra_info ? `<div class="log-diag-msg">${escapeHtml(item.extra_info)}</div>` : ''}
                            ${procChipsHtml}
                        </div>
                    </td>
                    <td>${discordBadge}</td>
                    <td>${tgBadge}</td>
                </tr>
            `;
        }).join('');

        elements.alertsHistoryTbody.innerHTML = html;
    }

    // =========================================================================
    // Tab Navigation Switcher & Routing
    // =========================================================================
    function switchTab(targetTab) {
        // Tab Key Mapping for Feature Manager
        const tabKeyMap = {
            overview: 'tab_overview',
            disk: 'tab_disk',
            apps: 'tab_apps',
            downloads: 'tab_downloads',
            notifications: 'tab_notifications',
            alerts: 'tab_alerts',
            focus: 'tab_focus',
            radar: 'tab_radar',
            power: 'tab_power',
            wallpaper: 'tab_wallpaper',
            lab: 'tab_lab',
            vocab: 'tab_vocab',
        };

        // If target tab is disabled in Module Control Center, fallback to first enabled tab
        const reqFeat = tabKeyMap[targetTab];
        if (window.featureManager && window.featureManager.config && reqFeat && window.featureManager.config[reqFeat] === false) {
            const tabsOrder = ['overview', 'disk', 'apps', 'power', 'downloads', 'radar', 'alerts', 'notifications', 'focus', 'lab', 'wallpaper', 'vocab'];
            const fallbackTab = tabsOrder.find(t => window.featureManager.config[tabKeyMap[t]]) || 'overview';
            if (fallbackTab === targetTab) return;
            showActionToast(`⚠️ Tab "${targetTab.toUpperCase()}" đang bị tắt trong Module Control Center`);
            switchTab(fallbackTab);
            return;
        }

        state.activeTab = targetTab;
        window.scrollTo({ top: 0, behavior: 'instant' });

        // 1. Update Sidebar Nav Items
        if (elements.navItemOverview) elements.navItemOverview.classList.toggle('active', targetTab === 'overview');
        if (elements.navItemDisk) elements.navItemDisk.classList.toggle('active', targetTab === 'disk');
        if (elements.navItemApps) elements.navItemApps.classList.toggle('active', targetTab === 'apps');
        if (elements.navItemDownloads) elements.navItemDownloads.classList.toggle('active', targetTab === 'downloads');
        if (elements.navItemNotif) elements.navItemNotif.classList.toggle('active', targetTab === 'notifications');
        if (elements.navItemAlerts) elements.navItemAlerts.classList.toggle('active', targetTab === 'alerts');
        if (elements.navItemFocus) elements.navItemFocus.classList.toggle('active', targetTab === 'focus');
        if (elements.navItemRadar) elements.navItemRadar.classList.toggle('active', targetTab === 'radar');
        if (elements.navItemPower) elements.navItemPower.classList.toggle('active', targetTab === 'power');
        if (elements.navItemWallpaper) elements.navItemWallpaper.classList.toggle('active', targetTab === 'wallpaper');
        if (elements.navItemLab) elements.navItemLab.classList.toggle('active', targetTab === 'lab');
        if (elements.navItemVocab) elements.navItemVocab.classList.toggle('active', targetTab === 'vocab');

        // 2. Switch Tab Views
        if (elements.viewOverview) elements.viewOverview.classList.toggle('hidden', targetTab !== 'overview');
        if (elements.viewDiskAnalysis) elements.viewDiskAnalysis.classList.toggle('hidden', targetTab !== 'disk');
        if (elements.viewAppsAnalysis) elements.viewAppsAnalysis.classList.toggle('hidden', targetTab !== 'apps');
        if (elements.viewDownloadsTracker) elements.viewDownloadsTracker.classList.toggle('hidden', targetTab !== 'downloads');
        if (elements.viewNotificationsHub) elements.viewNotificationsHub.classList.toggle('hidden', targetTab !== 'notifications');
        if (elements.viewAlertsSettings) elements.viewAlertsSettings.classList.toggle('hidden', targetTab !== 'alerts');
        if (elements.viewFocusDeck) elements.viewFocusDeck.classList.toggle('hidden', targetTab !== 'focus');
        if (elements.viewNetworkRadar) elements.viewNetworkRadar.classList.toggle('hidden', targetTab !== 'radar');
        if (elements.viewPowerEstimator) elements.viewPowerEstimator.classList.toggle('hidden', targetTab !== 'power');
        if (elements.viewWallpaperStudio) elements.viewWallpaperStudio.classList.toggle('hidden', targetTab !== 'wallpaper');
        if (elements.viewSnippetLab) elements.viewSnippetLab.classList.toggle('hidden', targetTab !== 'lab');
        if (elements.viewVocabBooster) elements.viewVocabBooster.classList.toggle('hidden', targetTab !== 'vocab');

        // 3. Update Header Breadcrumb Title & Trigger Sub-tab managers
        if (targetTab === 'overview') {
            elements.headerViewTitle.textContent = 'Real-time Monitor';
            if (metricsChart) metricsChart.update('none');
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'disk') {
            elements.headerViewTitle.textContent = 'Disk Breakdown';
            if (!state.diskBreakdownData) {
                loadAvailableDrives();
                fetchDiskBreakdown(state.selectedDrive, false);
            }
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'apps') {
            elements.headerViewTitle.textContent = 'App Analytics & Network Usage';
            fetchAppAnalytics(state.appTimeRange);
            setTimeout(() => {
                if (appTrendChart) appTrendChart.resize();
                if (appShareChart) appShareChart.resize();
            }, 60);
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'downloads') {
            elements.headerViewTitle.textContent = 'Downloads Tracker & History';
            if (!state.downloadsData) {
                fetchDownloads(state.downloadsFilter, false);
            }
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'notifications') {
            elements.headerViewTitle.textContent = 'Notifications & Events';
            renderNotificationsHub();
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'alerts') {
            elements.headerViewTitle.textContent = 'Alerts & Webhook Notifications';
            fetchAlertConfig();
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'focus') {
            elements.headerViewTitle.textContent = 'Cyber Matrix & Focus Deck';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabActivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'radar') {
            elements.headerViewTitle.textContent = 'Network & LAN Radar HUD';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabActivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
        } else if (targetTab === 'power') {
            elements.headerViewTitle.textContent = 'Power & Carbon Cost Estimator';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabActivated();
        } else if (targetTab === 'wallpaper') {
            elements.headerViewTitle.textContent = 'Dynamic Wallpaper Studio';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
            if (typeof wallpaperManager !== 'undefined') wallpaperManager.onTabActivated();
        } else if (targetTab === 'lab') {
            elements.headerViewTitle.textContent = 'AI Prompt & Code Snippet Laboratory';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
            if (typeof snippetLabManager !== 'undefined') snippetLabManager.onTabActivated();
        } else if (targetTab === 'vocab') {
            elements.headerViewTitle.textContent = 'Daily English & Vocab Booster';
            if (typeof focusDeckManager !== 'undefined') focusDeckManager.onTabDeactivated();
            if (typeof networkRadarManager !== 'undefined') networkRadarManager.onTabDeactivated();
            if (typeof powerEstimatorManager !== 'undefined') powerEstimatorManager.onTabDeactivated();
            if (typeof vocabManager !== 'undefined') vocabManager.onTabActivated();
        }
    }

    function setupEvents() {
        // Sidebar Navigation Clicks
        if (elements.navItemOverview) elements.navItemOverview.addEventListener('click', () => switchTab('overview'));
        if (elements.navItemDisk) elements.navItemDisk.addEventListener('click', () => switchTab('disk'));
        if (elements.navItemApps) elements.navItemApps.addEventListener('click', () => switchTab('apps'));
        if (elements.navItemDownloads) elements.navItemDownloads.addEventListener('click', () => switchTab('downloads'));
        if (elements.navItemNotif) elements.navItemNotif.addEventListener('click', () => switchTab('notifications'));
        if (elements.navItemAlerts) elements.navItemAlerts.addEventListener('click', () => switchTab('alerts'));
        if (elements.navItemFocus) elements.navItemFocus.addEventListener('click', () => switchTab('focus'));
        if (elements.navItemRadar) elements.navItemRadar.addEventListener('click', () => switchTab('radar'));
        if (elements.navItemPower) elements.navItemPower.addEventListener('click', () => switchTab('power'));
        if (elements.navItemWallpaper) elements.navItemWallpaper.addEventListener('click', () => switchTab('wallpaper'));
        if (elements.navItemLab) elements.navItemLab.addEventListener('click', () => switchTab('lab'));
        if (elements.navItemVocab) elements.navItemVocab.addEventListener('click', () => switchTab('vocab'));

        // Tab 6: Alerts & Webhooks Event Listeners
        if (elements.subnavAlertSettings) {
            elements.subnavAlertSettings.addEventListener('click', () => switchAlertSubTab('settings'));
        }
        if (elements.subnavAlertLogs) {
            elements.subnavAlertLogs.addEventListener('click', () => switchAlertSubTab('logs'));
        }

        if (elements.btnRefreshAlertLogs) {
            elements.btnRefreshAlertLogs.addEventListener('click', refreshAlertLogs);
        }

        if (elements.btnClearAlertLogs) {
            elements.btnClearAlertLogs.addEventListener('click', clearAlertHistory);
        }

        if (elements.alertLogsSearchInput) {
            elements.alertLogsSearchInput.addEventListener('input', (e) => {
                state.alertLogsSearchQuery = e.target.value;
                if (elements.btnClearAlertSearch) {
                    elements.btnClearAlertSearch.classList.toggle('hidden', !state.alertLogsSearchQuery);
                }
                renderAlertHistory(state.alertHistory);
            });
        }

        if (elements.btnClearAlertSearch) {
            elements.btnClearAlertSearch.addEventListener('click', () => {
                if (elements.alertLogsSearchInput) elements.alertLogsSearchInput.value = '';
                state.alertLogsSearchQuery = '';
                elements.btnClearAlertSearch.classList.add('hidden');
                renderAlertHistory(state.alertHistory);
            });
        }

        if (elements.alertTypeFilters) {
            elements.alertTypeFilters.querySelectorAll('.time-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    elements.alertTypeFilters.querySelectorAll('.time-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.alertLogsTypeFilter = btn.getAttribute('data-type') || 'all';
                    renderAlertHistory(state.alertHistory);
                });
            });
        }

        if (elements.alertChannelFilters) {
            elements.alertChannelFilters.querySelectorAll('.time-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    elements.alertChannelFilters.querySelectorAll('.time-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    state.alertLogsChannelFilter = btn.getAttribute('data-channel') || 'all';
                    renderAlertHistory(state.alertHistory);
                });
            });
        }

        if (elements.btnSaveAlertConfig) {
            elements.btnSaveAlertConfig.addEventListener('click', saveAlertConfig);
        }

        if (elements.btnTestAlert) {
            elements.btnTestAlert.addEventListener('click', sendTestAlert);
        }

        // Sliders & Numeric Inputs Sync
        if (elements.alertCpuSlider && elements.alertCpuInput) {
            elements.alertCpuSlider.addEventListener('input', (e) => {
                elements.alertCpuInput.value = e.target.value;
                if (elements.meterLimitCpu) elements.meterLimitCpu.textContent = `${e.target.value}%`;
                if (elements.meterMarkerCpu) elements.meterMarkerCpu.style.left = `${e.target.value}%`;
            });
            elements.alertCpuInput.addEventListener('input', (e) => {
                elements.alertCpuSlider.value = e.target.value;
                if (elements.meterLimitCpu) elements.meterLimitCpu.textContent = `${e.target.value}%`;
                if (elements.meterMarkerCpu) elements.meterMarkerCpu.style.left = `${e.target.value}%`;
            });
        }

        if (elements.alertRamSlider && elements.alertRamInput) {
            elements.alertRamSlider.addEventListener('input', (e) => {
                elements.alertRamInput.value = e.target.value;
                if (elements.meterLimitRam) elements.meterLimitRam.textContent = `${e.target.value}%`;
                if (elements.meterMarkerRam) elements.meterMarkerRam.style.left = `${e.target.value}%`;
            });
            elements.alertRamInput.addEventListener('input', (e) => {
                elements.alertRamSlider.value = e.target.value;
                if (elements.meterLimitRam) elements.meterLimitRam.textContent = `${e.target.value}%`;
                if (elements.meterMarkerRam) elements.meterMarkerRam.style.left = `${e.target.value}%`;
            });
        }

        if (elements.alertDiskSlider && elements.alertDiskInput) {
            elements.alertDiskSlider.addEventListener('input', (e) => {
                elements.alertDiskInput.value = e.target.value;
                if (elements.meterLimitDisk) elements.meterLimitDisk.textContent = `${e.target.value} GB`;
            });
            elements.alertDiskInput.addEventListener('input', (e) => {
                elements.alertDiskSlider.value = e.target.value;
                if (elements.meterLimitDisk) elements.meterLimitDisk.textContent = `${e.target.value} GB`;
            });
        }

        if (elements.alertCooldownInput && elements.alertBadgeCooldownMin) {
            elements.alertCooldownInput.addEventListener('input', (e) => {
                elements.alertBadgeCooldownMin.textContent = `${e.target.value || 10}m`;
            });
        }

        // Mask/Show Toggles
        const SVG_EYE = '<svg class="icon-mask-eye" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        const SVG_EYE_OFF = '<svg class="icon-mask-eye" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

        if (elements.btnToggleDiscordMask && elements.alertDiscordUrl) {
            elements.btnToggleDiscordMask.addEventListener('click', () => {
                const isPass = elements.alertDiscordUrl.type === 'password';
                elements.alertDiscordUrl.type = isPass ? 'text' : 'password';
                elements.btnToggleDiscordMask.innerHTML = isPass ? SVG_EYE_OFF : SVG_EYE;
            });
        }

        if (elements.btnToggleTgMask && elements.alertTelegramToken) {
            elements.btnToggleTgMask.addEventListener('click', () => {
                const isPass = elements.alertTelegramToken.type === 'password';
                elements.alertTelegramToken.type = isPass ? 'text' : 'password';
                elements.btnToggleTgMask.innerHTML = isPass ? SVG_EYE_OFF : SVG_EYE;
            });
        }

        const btnToggleGeminiKey = document.getElementById('btn-toggle-key-visibility');
        const geminiApiKeyInput = document.getElementById('gemini-api-key-input');
        if (btnToggleGeminiKey && geminiApiKeyInput) {
            btnToggleGeminiKey.addEventListener('click', () => {
                const isPass = geminiApiKeyInput.type === 'password';
                geminiApiKeyInput.type = isPass ? 'text' : 'password';
                btnToggleGeminiKey.innerHTML = isPass ? SVG_EYE_OFF : SVG_EYE;
            });
        }

        // Tab 5: Downloads Tracker Event Listeners
        if (elements.dlTimeFilters) {
            elements.dlTimeFilters.querySelectorAll('.time-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    elements.dlTimeFilters.querySelectorAll('.time-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const filter = btn.getAttribute('data-filter') || 'today';
                    fetchDownloads(filter, false);
                });
            });
        }

        if (elements.dlSearchInput) {
            elements.dlSearchInput.addEventListener('input', (e) => {
                state.downloadsSearchQuery = e.target.value;
                if (elements.btnClearDlSearch) {
                    elements.btnClearDlSearch.classList.toggle('hidden', !state.downloadsSearchQuery);
                }
                if (state.downloadsData) {
                    renderDownloadsTable(state.downloadsData.files);
                }
            });
        }

        if (elements.btnClearDlSearch) {
            elements.btnClearDlSearch.addEventListener('click', () => {
                if (elements.dlSearchInput) elements.dlSearchInput.value = '';
                state.downloadsSearchQuery = '';
                elements.btnClearDlSearch.classList.add('hidden');
                if (state.downloadsData) {
                    renderDownloadsTable(state.downloadsData.files);
                }
            });
        }

        if (elements.dlTypeFilter) {
            elements.dlTypeFilter.addEventListener('change', (e) => {
                state.downloadsTypeFilter = e.target.value;
                if (state.downloadsData) {
                    renderDownloadsTable(state.downloadsData.files);
                }
            });
        }

        if (elements.btnRefreshDownloads) {
            elements.btnRefreshDownloads.addEventListener('click', () => {
                fetchDownloads(state.downloadsFilter, true);
            });
        }

        if (elements.btnOpenDownloadsDir) {
            elements.btnOpenDownloadsDir.addEventListener('click', () => {
                openDownloadsFolder();
            });
        }

        if (elements.downloadsTbody) {
            elements.downloadsTbody.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-open-in-folder');
                if (btn) {
                    const filePath = btn.getAttribute('data-path');
                    if (filePath) {
                        openFileInExplorer(filePath);
                    }
                }
            });
        }

        // 1. AI Copilot Header Button -> Toggle AI Flyout Popup
        if (elements.btnHeaderAiCopilot) {
            elements.btnHeaderAiCopilot.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleAiFlyout();
            });
        }

        // Theme Mode Toggle Button Click
        if (elements.btnThemeToggle) {
            elements.btnThemeToggle.addEventListener('click', () => {
                toggleTheme();
            });
        }

        // Header Notification Bell Icon Click -> Toggle Overview Dropdown
        if (elements.btnNotificationBell) {
            elements.btnNotificationBell.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleNotifDropdown();
            });
        }

        // Global Click Outside Handler -> Auto-Close Header Popups
        document.addEventListener('click', (e) => {
            const inAi = elements.aiFlyoutWrapper && elements.aiFlyoutWrapper.contains(e.target);
            const inNotif = elements.notifFlyoutWrapper && elements.notifFlyoutWrapper.contains(e.target);
            if (!inAi && !inNotif) {
                closeAllHeaderFlyouts();
            }
        });

        // Close buttons inside popups
        if (elements.btnCloseAiFlyout) {
            elements.btnCloseAiFlyout.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllHeaderFlyouts();
            });
        }

        if (elements.btnCloseNotifDropdown) {
            elements.btnCloseNotifDropdown.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllHeaderFlyouts();
            });
        }

        // Open Gemini Settings from Flyout
        if (elements.btnFlyoutGeminiSettings) {
            elements.btnFlyoutGeminiSettings.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllHeaderFlyouts();
                openGeminiSettingsModal();
            });
        }

        // Expand to Full Modal from Flyout
        if (elements.btnFlyoutExpandChat) {
            elements.btnFlyoutExpandChat.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllHeaderFlyouts();
                openExpandedChatModal();
            });
        }

        // Dropdown: View All in Hub
        if (elements.btnDropdownViewHub) {
            elements.btnDropdownViewHub.addEventListener('click', () => {
                closeAllHeaderFlyouts();
                switchTab('notifications');
            });
        }

        // Dropdown: Mark All Read
        if (elements.btnDropdownMarkAll) {
            elements.btnDropdownMarkAll.addEventListener('click', (e) => {
                e.stopPropagation();
                markAllNotificationsRead();
                renderNotificationDropdown();
            });
        }

        // Flyout AI Prompt Bar & Send Button
        if (elements.btnFlyoutSend && elements.flyoutPromptInput) {
            elements.btnFlyoutSend.addEventListener('click', () => {
                const q = elements.flyoutPromptInput.value;
                if (q) submitFlyoutQuestion(q);
            });

            elements.flyoutPromptInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = elements.flyoutPromptInput.value;
                    if (q) submitFlyoutQuestion(q);
                }
            });
        }

        // Flyout Quick Prompt Chips
        document.querySelectorAll('.flyout-chip-btn').forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) submitFlyoutQuestion(query);
            });
        });

        // Notifications Hub Filter Buttons
        document.querySelectorAll('.hub-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const filter = btn.getAttribute('data-filter');
                state.hubFilter = filter;
                document.querySelectorAll('.hub-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderNotificationsHub();
            });
        });

        // Notifications Hub Search Filter Input
        elements.hubSearchInput.addEventListener('input', (e) => {
            state.hubSearchQuery = e.target.value;
            renderNotificationsHub();
        });

        // Mark All Read in Hub
        elements.btnHubMarkAll.addEventListener('click', () => {
            markAllNotificationsRead();
        });

        // Force Refresh Hub
        elements.btnHubRefresh.addEventListener('click', () => {
            fetchNotifications(true);
        });

        // Pause / Resume Stream
        elements.btnPauseStream.addEventListener('click', () => {
            state.isPaused = !state.isPaused;
            if (state.isPaused) {
                elements.textPauseBtn.textContent = 'Paused';
                elements.iconPause.classList.add('hidden');
                elements.iconPlay.classList.remove('hidden');
            } else {
                elements.textPauseBtn.textContent = 'Live';
                elements.iconPause.classList.remove('hidden');
                elements.iconPlay.classList.add('hidden');
                if (state.lastMetrics) processIncomingMetrics(state.lastMetrics);
            }
        });

        // Manual Refresh Button in Header
        elements.btnManualRefresh.addEventListener('click', () => {
            if (state.activeTab === 'overview') {
                fetchMetricsSnapshot();
            } else if (state.activeTab === 'disk') {
                fetchDiskBreakdown(state.selectedDrive, true);
            } else if (state.activeTab === 'apps') {
                fetchAppAnalytics(state.appTimeRange, true);
            } else {
                fetchNotifications(true);
            }
        });

        // Process Sorting Tabs
        elements.tabSortCpu.addEventListener('click', () => {
            state.procSortMode = 'cpu';
            elements.tabSortCpu.classList.add('active');
            elements.tabSortRam.classList.remove('active');
            if (state.lastMetrics) renderProcessesTable(state.lastMetrics.processes);
        });

        elements.tabSortRam.addEventListener('click', () => {
            state.procSortMode = 'ram';
            elements.tabSortRam.classList.add('active');
            elements.tabSortCpu.classList.remove('active');
            if (state.lastMetrics) renderProcessesTable(state.lastMetrics.processes);
        });

        // Process Search Filter
        elements.procSearchInput.addEventListener('input', (e) => {
            state.procSearchQuery = e.target.value;
            if (state.lastMetrics) renderProcessesTable(state.lastMetrics.processes);
        });

        // Disk Scan Now Button
        elements.btnScanDisk.addEventListener('click', () => {
            fetchDiskBreakdown(state.selectedDrive, true);
        });

        // Disk Search Filter
        elements.diskSearchInput.addEventListener('input', (e) => {
            state.diskSearchQuery = e.target.value;
            if (state.diskBreakdownData) renderDiskTable(state.diskBreakdownData.items);
        });

        // App Analytics Time Range Filter Buttons
        document.querySelectorAll('.time-range-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const range = btn.getAttribute('data-range');
                document.querySelectorAll('.time-range-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                fetchAppAnalytics(range);
            });
        });

        // App Analytics Search Filter & Clear Button
        if (elements.appSearchInput) {
            elements.appSearchInput.addEventListener('input', (e) => {
                state.appSearchQuery = e.target.value;
                if (elements.btnClearAppSearch) {
                    elements.btnClearAppSearch.classList.toggle('hidden', !state.appSearchQuery);
                }
                if (state.appAnalyticsData) renderAppTable(state.appAnalyticsData.apps);
            });
        }

        if (elements.btnClearAppSearch) {
            elements.btnClearAppSearch.addEventListener('click', () => {
                if (elements.appSearchInput) {
                    elements.appSearchInput.value = '';
                    elements.appSearchInput.focus();
                }
                state.appSearchQuery = '';
                elements.btnClearAppSearch.classList.add('hidden');
                if (state.appAnalyticsData) renderAppTable(state.appAnalyticsData.apps);
            });
        }

        // App Analytics Column Sorting Header Clicks
        document.querySelectorAll('#app-breakdown-table th.sortable-th').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-sort');
                if (state.appSortKey === key) {
                    state.appSortOrder = state.appSortOrder === 'asc' ? 'desc' : 'asc';
                } else {
                    state.appSortKey = key;
                    state.appSortOrder = key === 'app_name' || key === 'category' ? 'asc' : 'desc';
                }
                if (state.appAnalyticsData) renderAppTable(state.appAnalyticsData.apps);
            });
        });

        // Click to expand / collapse subfolders (Multi-level tree expansion)
        if (elements.diskBreakdownTbody) {
            elements.diskBreakdownTbody.addEventListener('click', (e) => {
                // If clicked preview button, ignore row expand/collapse
                if (e.target.closest('[data-preview-path]')) return;

                const targetRow = e.target.closest('.disk-row-expandable');
                if (targetRow) {
                    const path = targetRow.getAttribute('data-path');
                    const depth = parseInt(targetRow.getAttribute('data-depth') || '1', 10);
                    if (path) {
                        toggleSubfolderRow(targetRow, path, depth);
                    }
                }
            });
        }

        // Global Click Delegate for In-Browser Media & Document Preview (Images, Videos, PDFs, Text)
        document.addEventListener('click', (e) => {
            const previewBtn = e.target.closest('[data-preview-path]');
            if (previewBtn) {
                e.preventDefault();
                e.stopPropagation();
                const filePath = previewBtn.getAttribute('data-preview-path');
                if (filePath) {
                    mediaViewerManager.open(filePath);
                }
            }
        });

        // Quick Action 1: Flush DNS
        if (elements.btnActionFlushDns) {
            elements.btnActionFlushDns.addEventListener('click', async () => {
                elements.btnActionFlushDns.classList.add('loading');
                if (elements.iconFlushDns) elements.iconFlushDns.classList.add('spin');

                try {
                    const res = await fetch('/api/actions/flush-dns', { method: 'POST' });
                    const result = await res.json();
                    if (result.status === 'success') {
                        showActionToast('⚡ ' + (result.message || 'DNS Cache flushed successfully!'));
                    } else {
                        showActionToast('❌ ' + (result.message || 'Failed to flush DNS.'), true);
                    }
                } catch (e) {
                    showActionToast('❌ Network error executing Flush DNS.', true);
                } finally {
                    elements.btnActionFlushDns.classList.remove('loading');
                    if (elements.iconFlushDns) elements.iconFlushDns.classList.remove('spin');
                }
            });
        }

        // Quick Action 2: Clean Temp
        if (elements.btnActionCleanTemp) {
            elements.btnActionCleanTemp.addEventListener('click', async () => {
                elements.btnActionCleanTemp.classList.add('loading');
                if (elements.iconCleanTemp) elements.iconCleanTemp.classList.add('spin');

                try {
                    const res = await fetch('/api/actions/clean-temp', { method: 'POST' });
                    const result = await res.json();
                    if (result.status === 'success') {
                        showActionToast('🧹 ' + (result.message || 'Temp files cleaned successfully!'));
                    } else {
                        showActionToast('❌ ' + (result.message || 'Failed to clean temp files.'), true);
                    }
                } catch (e) {
                    showActionToast('❌ Network error cleaning temp files.', true);
                } finally {
                    elements.btnActionCleanTemp.classList.remove('loading');
                    if (elements.iconCleanTemp) elements.iconCleanTemp.classList.remove('spin');
                }
            });
        }

        // Card AI Copilot Prompt Bar & Send Button
        if (elements.btnCopilotSend && elements.copilotPromptInput) {
            elements.btnCopilotSend.addEventListener('click', () => {
                const q = elements.copilotPromptInput.value;
                if (q) submitCopilotQuestion(q);
            });

            elements.copilotPromptInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = elements.copilotPromptInput.value;
                    if (q) submitCopilotQuestion(q);
                }
            });
        }

        // Card AI Copilot Quick Chips
        document.querySelectorAll('.quick-chip-btn').forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) submitCopilotQuestion(query);
            });
        });

        // Close Copilot Chat Response in Card
        if (elements.btnCloseCopilotChat && elements.copilotChatResponse) {
            elements.btnCloseCopilotChat.addEventListener('click', () => {
                elements.copilotChatResponse.classList.add('hidden');
                if (elements.copilotInsightsBox) elements.copilotInsightsBox.classList.remove('hidden');
                if (elements.copilotQuickChips) elements.copilotQuickChips.classList.remove('hidden');
            });
        }

        // Expanded Gemini Chat Hub Modal Events
        if (elements.btnExpandGeminiChat) {
            elements.btnExpandGeminiChat.addEventListener('click', () => {
                openExpandedChatModal();
            });
        }

        if (elements.btnExpandFromBubble) {
            elements.btnExpandFromBubble.addEventListener('click', () => {
                openExpandedChatModal();
            });
        }

        if (elements.btnCloseExpandedChat) {
            elements.btnCloseExpandedChat.addEventListener('click', () => {
                closeExpandedChatModal();
            });
        }

        if (elements.btnClearChatHistory && elements.expandedMessagesContainer) {
            elements.btnClearChatHistory.addEventListener('click', () => {
                elements.expandedMessagesContainer.innerHTML = `
                    <div class="chat-msg bot-msg">
                        <div class="chat-avatar bot-avatar">✨</div>
                        <div class="chat-bubble bot-bubble">
                            <div class="chat-msg-header">
                                <span class="chat-sender-name">Gemini AI Copilot</span>
                                <span class="chat-time-tag">Online</span>
                            </div>
                            <div class="chat-msg-text">
                                Lịch sử trò chuyện đã được xóa. Hãy hỏi tôi bất cứ điều gì về tình trạng máy tính của bạn!
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (elements.btnExpandedSend && elements.expandedPromptInput) {
            elements.btnExpandedSend.addEventListener('click', () => {
                const q = elements.expandedPromptInput.value;
                if (q) submitExpandedChatQuestion(q);
            });

            elements.expandedPromptInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    const q = elements.expandedPromptInput.value;
                    if (q) submitExpandedChatQuestion(q);
                }
            });
        }

        // Expanded Chat Quick Chips
        document.querySelectorAll('.expanded-chip-btn').forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) submitExpandedChatQuestion(query);
            });
        });

        // Gemini Pro Settings Modal Events
        if (elements.btnOpenGeminiModal) {
            elements.btnOpenGeminiModal.addEventListener('click', () => {
                openGeminiSettingsModal();
            });
        }

        if (elements.btnCloseGeminiModal) {
            elements.btnCloseGeminiModal.addEventListener('click', () => {
                closeGeminiSettingsModal();
            });
        }

        if (elements.btnCancelGeminiModal) {
            elements.btnCancelGeminiModal.addEventListener('click', () => {
                closeGeminiSettingsModal();
            });
        }

        if (elements.btnToggleKeyVisibility && elements.geminiApiKeyInput) {
            elements.btnToggleKeyVisibility.addEventListener('click', () => {
                const currentType = elements.geminiApiKeyInput.getAttribute('type');
                if (currentType === 'password') {
                    elements.geminiApiKeyInput.setAttribute('type', 'text');
                    elements.btnToggleKeyVisibility.textContent = '🙈';
                } else {
                    elements.geminiApiKeyInput.setAttribute('type', 'password');
                    elements.btnToggleKeyVisibility.textContent = '👁️';
                }
            });
        }

        if (elements.btnSaveGeminiConfig) {
            elements.btnSaveGeminiConfig.addEventListener('click', async () => {
                await saveGeminiConfiguration();
            });
        }

        if (elements.btnClearGeminiKey) {
            elements.btnClearGeminiKey.addEventListener('click', async () => {
                if (elements.geminiApiKeyInput) elements.geminiApiKeyInput.value = '';
                await saveGeminiConfiguration();
            });
        }
    }

    async function openGeminiSettingsModal() {
        if (!elements.geminiSettingsModal) return;
        elements.geminiSettingsModal.classList.remove('hidden');

        if (elements.geminiModalStatus) {
            elements.geminiModalStatus.className = 'modal-status-box hidden';
            elements.geminiModalStatus.textContent = '';
        }

        try {
            const res = await fetch('/api/gemini/config');
            if (res.ok) {
                const cfg = await res.json();
                if (elements.geminiModelSelect && cfg.model) {
                    elements.geminiModelSelect.value = cfg.model;
                }
                if (elements.geminiApiKeyInput) {
                    elements.geminiApiKeyInput.value = '';
                    if (cfg.configured) {
                        elements.geminiApiKeyInput.placeholder = `Active key: ${cfg.masked_key} (Enter new to replace)`;
                    } else {
                        elements.geminiApiKeyInput.placeholder = 'Enter AIzaSy...';
                    }
                }
            }
        } catch (e) {}
    }

    function closeGeminiSettingsModal() {
        if (elements.geminiSettingsModal) {
            elements.geminiSettingsModal.classList.add('hidden');
        }
    }

    async function saveGeminiConfiguration() {
        const apiKey = elements.geminiApiKeyInput ? elements.geminiApiKeyInput.value.trim() : '';
        const model = elements.geminiModelSelect ? elements.geminiModelSelect.value : 'gemini-2.5-pro';

        if (elements.btnSaveGeminiConfig) {
            elements.btnSaveGeminiConfig.disabled = true;
            if (elements.geminiSaveText) elements.geminiSaveText.textContent = 'Testing & Connecting...';
        }

        if (elements.geminiModalStatus) {
            elements.geminiModalStatus.className = 'modal-status-box hidden';
        }

        try {
            const res = await fetch('/api/gemini/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKey, model: model }),
            });

            const data = await res.json();

            if (data.status === 'success') {
                if (elements.geminiModalStatus) {
                    elements.geminiModalStatus.className = 'modal-status-box status-success';
                    elements.geminiModalStatus.textContent = '✅ ' + data.message;
                }
                state.geminiConfigured = Boolean(apiKey);
                state.geminiModel = model;
                updateGeminiHeaderUI();
                showActionToast('✨ ' + data.message);

                setTimeout(() => {
                    closeGeminiSettingsModal();
                }, 1200);
            } else {
                if (elements.geminiModalStatus) {
                    elements.geminiModalStatus.className = 'modal-status-box status-error';
                    elements.geminiModalStatus.textContent = '❌ ' + (data.message || 'Verification failed.');
                }
            }
        } catch (e) {
            if (elements.geminiModalStatus) {
                elements.geminiModalStatus.className = 'modal-status-box status-error';
                elements.geminiModalStatus.textContent = '❌ Network error communicating with server.';
            }
        } finally {
            if (elements.btnSaveGeminiConfig) {
                elements.btnSaveGeminiConfig.disabled = false;
                if (elements.geminiSaveText) elements.geminiSaveText.textContent = 'Connect & Save';
            }
        }
    }

    // =========================================================================
    // Tab 7: Cyber Matrix & Hyper Focus Deck Module
    // =========================================================================
    const focusDeckManager = {
        audioCtx: null,
        soundNodes: {
            rain: null,
            hum: null,
            gamma: null,
            masterGain: null,
            analyser: null
        },
        matrixState: {
            canvas: null,
            ctx: null,
            animId: null,
            drops: [],
            fontSize: 15,
            lastDrawTime: 0,
            density: 'normal',
            isPaused: false,
            cpuPercent: 0,
            chars: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ日ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ⚡ΨΩΞΔλ0101'
        },
        pomodoroState: {
            mode: 'work25',
            duration: 1500, // 25 min
            remaining: 1500,
            isRunning: false,
            timerId: null,
            streak: parseInt(localStorage.getItem('cyber_focus_streak') || '0', 10),
            totalFocusSeconds: parseInt(localStorage.getItem('cyber_focus_total_sec') || '0', 10)
        },
        quotes: [
            { quote: "Talk is cheap. Show me the code.", author: "Linus Torvalds, Linux Creator" },
            { quote: "Programs must be written for people to read, and only incidentally for machines to execute.", author: "Harold Abelson, SICP" },
            { quote: "Any fool can write code that a computer can understand. Good programmers write code that humans can understand.", author: "Martin Fowler" },
            { quote: "Simplicity is prerequisite for reliability.", author: "Edsger W. Dijkstra" },
            { quote: "First, solve the problem. Then, write the code.", author: "John Johnson" },
            { quote: "Make it work, make it right, make it fast.", author: "Kent Beck" },
            { quote: "Sometimes it pays to stay in bed on Monday, rather than spending the rest of the week debugging Monday's code.", author: "Dan Salomon" },
            { quote: "It's not a bug – it's an undocumented feature.", author: "Anonymous Hacker" },
            { quote: "The only way to go fast, is to go well.", author: "Robert C. Martin (Uncle Bob)" },
            { quote: "There are two hard things in Computer Science: cache invalidation and naming things.", author: "Phil Karlton" },
            { quote: "Wake up, Neo... The Matrix has you. Follow the white rabbit.", author: "Morpheus, The Matrix" },
            { quote: "One machine can do the work of fifty ordinary men. No machine can do the work of one extraordinary man.", author: "Elbert Hubbard" },
            { quote: "Stay hungry, stay foolish.", author: "Steve Jobs" },
            { quote: "The future is already here – it's just not evenly distributed.", author: "William Gibson, Neuromancer" },
            { quote: "Focus is a muscle. The more you eliminate distractions, the stronger your deep work becomes.", author: "Cal Newport, Deep Work" }
        ],
        quoteIndex: 0,
        typewriterTimer: null,

        init() {
            this.initMatrix();
            this.initPomodoro();
            this.initAudioUI();
            this.initTerminal();
        },

        onTabActivated() {
            this.startMatrix();
            if (this.matrixState.canvas) {
                this.resizeMatrixCanvas();
            }
        },

        onTabDeactivated() {
            this.stopMatrix();
        },

        onMetricsUpdate(cpuPercent) {
            this.matrixState.cpuPercent = cpuPercent || 0;
            const speedText = document.getElementById('matrix-speed-text');
            const hudCoreLoad = document.getElementById('hud-core-load');
            const hudCadence = document.getElementById('hud-flow-cadence');

            if (speedText) {
                speedText.textContent = `SYNCED (CPU: ${cpuPercent.toFixed(1)}%)`;
            }
            if (hudCoreLoad) {
                hudCoreLoad.textContent = `${cpuPercent.toFixed(1)}%`;
            }
            if (hudCadence) {
                if (cpuPercent > 60) hudCadence.textContent = 'Hyper Overclock ⚡';
                else if (cpuPercent > 25) hudCadence.textContent = 'Steady Cascade 🌊';
                else hudCadence.textContent = 'Calm Pulse 🍃';
            }
        },

        // --- 1. Matrix Live Visualizer ---
        initMatrix() {
            const canvas = document.getElementById('matrix-rain-canvas');
            if (!canvas) return;
            this.matrixState.canvas = canvas;
            this.matrixState.ctx = canvas.getContext('2d');

            window.addEventListener('resize', () => {
                if (state.activeTab === 'focus') {
                    this.resizeMatrixCanvas();
                }
            });

            const densitySelector = document.getElementById('matrix-density-selector');
            if (densitySelector) {
                densitySelector.querySelectorAll('.matrix-pill').forEach(btn => {
                    btn.addEventListener('click', () => {
                        densitySelector.querySelectorAll('.matrix-pill').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const density = btn.getAttribute('data-density');
                        this.setMatrixDensity(density);
                    });
                });
            }

            const btnToggle = document.getElementById('btn-toggle-matrix-rain');
            if (btnToggle) {
                btnToggle.addEventListener('click', () => {
                    this.matrixState.isPaused = !this.matrixState.isPaused;
                    const iconPause = document.getElementById('matrix-icon-pause');
                    const iconPlay = document.getElementById('matrix-icon-play');
                    const btnText = document.getElementById('matrix-stream-btn-text');

                    if (this.matrixState.isPaused) {
                        if (iconPause) iconPause.classList.add('hidden');
                        if (iconPlay) iconPlay.classList.remove('hidden');
                        if (btnText) btnText.textContent = 'Paused';
                    } else {
                        if (iconPause) iconPause.classList.remove('hidden');
                        if (iconPlay) iconPlay.classList.add('hidden');
                        if (btnText) btnText.textContent = 'Live Rain';
                    }
                });
            }
        },

        setMatrixDensity(density) {
            this.matrixState.density = density;
            if (density === 'dense') this.matrixState.fontSize = 11;
            else if (density === 'flux') this.matrixState.fontSize = 8;
            else this.matrixState.fontSize = 15;
            this.resizeMatrixCanvas();
        },

        resizeMatrixCanvas() {
            const canvas = this.matrixState.canvas;
            if (!canvas || !canvas.parentElement) return;

            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width || 800;
            canvas.height = rect.height || 250;

            const columns = Math.floor(canvas.width / this.matrixState.fontSize);
            this.matrixState.drops = [];
            for (let i = 0; i < columns; i++) {
                this.matrixState.drops[i] = Math.floor(Math.random() * -50);
            }

            const hudChar = document.getElementById('hud-char-count');
            if (hudChar) {
                hudChar.textContent = `${columns * 28}/s`;
            }
        },

        startMatrix() {
            if (this.matrixState.animId) return;
            this.resizeMatrixCanvas();

            const renderLoop = (timestamp) => {
                this.matrixState.animId = requestAnimationFrame(renderLoop);

                if (this.matrixState.isPaused || state.activeTab !== 'focus') return;

                // Dynamically throttle FPS according to CPU load
                const cpu = Math.min(100, Math.max(0, this.matrixState.cpuPercent || 5));
                const frameDelay = Math.max(16, 65 - (cpu * 0.48));

                if (timestamp - this.matrixState.lastDrawTime < frameDelay) return;
                this.matrixState.lastDrawTime = timestamp;

                this.drawMatrixFrame();
            };

            this.matrixState.animId = requestAnimationFrame(renderLoop);
        },

        stopMatrix() {
            if (this.matrixState.animId) {
                cancelAnimationFrame(this.matrixState.animId);
                this.matrixState.animId = null;
            }
        },

        drawMatrixFrame() {
            const ctx = this.matrixState.ctx;
            const canvas = this.matrixState.canvas;
            if (!ctx || !canvas) return;

            const isLight = state.currentTheme === 'light';

            // Subtle fade trail
            ctx.fillStyle = isLight ? 'rgba(237, 240, 245, 0.16)' : 'rgba(5, 8, 12, 0.14)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const fontSize = this.matrixState.fontSize;
            ctx.font = `${fontSize}px "JetBrains Mono", monospace`;

            const primaryColor = isLight ? '#059669' : '#c2f83b';
            const headColor = isLight ? '#0f172a' : '#ffffff';
            const chars = this.matrixState.chars;

            for (let i = 0; i < this.matrixState.drops.length; i++) {
                const text = chars.charAt(Math.floor(Math.random() * chars.length));
                const x = i * fontSize;
                const y = this.matrixState.drops[i] * fontSize;

                if (y >= 0 && y <= canvas.height + fontSize) {
                    // Lead character highlight
                    ctx.fillStyle = headColor;
                    ctx.fillText(text, x, y);

                    // Body stream character
                    ctx.fillStyle = primaryColor;
                    ctx.fillText(chars.charAt(Math.floor(Math.random() * chars.length)), x, y - fontSize);
                }

                if (y > canvas.height && Math.random() > 0.975) {
                    this.matrixState.drops[i] = 0;
                }
                this.matrixState.drops[i]++;
            }
        },

        // --- 2. Pomodoro & Hyper Focus Mode ---
        initPomodoro() {
            const streakCount = document.getElementById('focus-streak-count');
            if (streakCount) {
                streakCount.textContent = `${this.pomodoroState.streak} Sessions`;
            }

            const modeTabs = document.getElementById('focus-mode-tabs');
            if (modeTabs) {
                modeTabs.querySelectorAll('.focus-mode-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (this.pomodoroState.isRunning) {
                            if (!confirm('Phiên tập trung đang chạy. Bạn có muốn đổi chế độ và đặt lại thời gian không?')) return;
                            this.stopPomodoro();
                        }
                        modeTabs.querySelectorAll('.focus-mode-btn').forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        const mode = btn.getAttribute('data-mode');
                        const time = parseInt(btn.getAttribute('data-time') || '1500', 10);
                        this.setPomodoroMode(mode, time);
                    });
                });
            }

            const btnEngage = document.getElementById('btn-engage-focus-matrix');
            if (btnEngage) {
                btnEngage.addEventListener('click', () => {
                    this.togglePomodoroEngage();
                });
            }

            const btnPause = document.getElementById('btn-focus-pause');
            if (btnPause) {
                btnPause.addEventListener('click', () => {
                    this.togglePomodoroPause();
                });
            }

            const btnReset = document.getElementById('btn-focus-reset');
            if (btnReset) {
                btnReset.addEventListener('click', () => {
                    this.resetPomodoro();
                });
            }

            const btnSkip = document.getElementById('btn-focus-skip');
            if (btnSkip) {
                btnSkip.addEventListener('click', () => {
                    this.skipPomodoroPhase();
                });
            }

            this.updatePomodoroDisplay();
        },

        setPomodoroMode(mode, duration) {
            this.pomodoroState.mode = mode;
            this.pomodoroState.duration = duration;
            this.pomodoroState.remaining = duration;
            this.updatePomodoroDisplay();
        },

        async togglePomodoroEngage() {
            if (this.pomodoroState.isRunning) {
                // Stop / Disengage
                this.stopPomodoro();
                showActionToast('⏹️ Focus Matrix disengaged.');
            } else {
                // Engage: Call backend to trim memory
                const btnEngage = document.getElementById('btn-engage-focus-matrix');
                if (btnEngage) btnEngage.disabled = true;

                try {
                    const res = await fetch('/api/focus/engage', { method: 'POST' });
                    const data = await res.json();
                    if (data.status === 'success') {
                        showActionToast(`⚡ Focus Matrix Engaged! Released ~${data.freed_mb} MB RAM. Host primed for Deep Work.`);
                    }
                } catch (e) {
                    showActionToast('⚡ Focus Matrix Engaged! Deep Work session active.');
                } finally {
                    if (btnEngage) btnEngage.disabled = false;
                }

                this.startPomodoro();
                this.playBeep(880, 0.15, 'sine');
            }
        },

        startPomodoro() {
            this.pomodoroState.isRunning = true;
            const btnEngage = document.getElementById('btn-engage-focus-matrix');
            const btnText = document.getElementById('engage-btn-text');
            const btnPause = document.getElementById('btn-focus-pause');
            const statusLabel = document.getElementById('pomodoro-status-label');

            if (btnEngage) btnEngage.classList.add('active-engaged');
            if (btnText) btnText.textContent = 'DISENGAGE / STOP';
            if (btnPause) {
                btnPause.disabled = false;
                btnPause.querySelector('span').textContent = 'Tạm Dừng';
            }
            if (statusLabel) {
                statusLabel.textContent = this.pomodoroState.mode === 'break5' ? 'CYBER BREAK IN PROGRESS' : 'FOCUS MATRIX ENGAGED';
                statusLabel.style.color = 'var(--accent-lime)';
            }

            clearInterval(this.pomodoroState.timerId);
            this.pomodoroState.timerId = setInterval(() => {
                if (this.pomodoroState.remaining > 0) {
                    this.pomodoroState.remaining--;
                    this.pomodoroState.totalFocusSeconds++;
                    this.updatePomodoroDisplay();
                } else {
                    this.onPomodoroComplete();
                }
            }, 1000);
        },

        stopPomodoro() {
            this.pomodoroState.isRunning = false;
            clearInterval(this.pomodoroState.timerId);
            this.pomodoroState.timerId = null;

            const btnEngage = document.getElementById('btn-engage-focus-matrix');
            const btnText = document.getElementById('engage-btn-text');
            const btnPause = document.getElementById('btn-focus-pause');
            const statusLabel = document.getElementById('pomodoro-status-label');

            if (btnEngage) btnEngage.classList.remove('active-engaged');
            if (btnText) btnText.textContent = 'ENGAGE FOCUS MATRIX';
            if (btnPause) {
                btnPause.disabled = true;
                btnPause.querySelector('span').textContent = 'Tạm Dừng';
            }
            if (statusLabel) {
                statusLabel.textContent = 'READY TO ENGAGE';
                statusLabel.style.color = '';
            }
        },

        togglePomodoroPause() {
            const btnPause = document.getElementById('btn-focus-pause');
            const statusLabel = document.getElementById('pomodoro-status-label');

            if (this.pomodoroState.timerId) {
                // Pause
                clearInterval(this.pomodoroState.timerId);
                this.pomodoroState.timerId = null;
                if (btnPause) btnPause.querySelector('span').textContent = 'Tiếp Tục';
                if (statusLabel) {
                    statusLabel.textContent = 'SESSION PAUSED';
                    statusLabel.style.color = '#fbbf24';
                }
            } else if (this.pomodoroState.isRunning) {
                // Resume
                this.pomodoroState.timerId = setInterval(() => {
                    if (this.pomodoroState.remaining > 0) {
                        this.pomodoroState.remaining--;
                        this.pomodoroState.totalFocusSeconds++;
                        this.updatePomodoroDisplay();
                    } else {
                        this.onPomodoroComplete();
                    }
                }, 1000);
                if (btnPause) btnPause.querySelector('span').textContent = 'Tạm Dừng';
                if (statusLabel) {
                    statusLabel.textContent = 'FOCUS MATRIX ENGAGED';
                    statusLabel.style.color = 'var(--accent-lime)';
                }
            }
        },

        resetPomodoro() {
            this.stopPomodoro();
            this.pomodoroState.remaining = this.pomodoroState.duration;
            this.updatePomodoroDisplay();
            showActionToast('🔄 Focus session reset.');
        },

        skipPomodoroPhase() {
            this.stopPomodoro();
            if (this.pomodoroState.mode === 'break5') {
                const workBtn = document.querySelector('[data-mode="work25"]');
                if (workBtn) workBtn.click();
            } else {
                const breakBtn = document.querySelector('[data-mode="break5"]');
                if (breakBtn) breakBtn.click();
            }
            showActionToast('⏭️ Skipped to next phase.');
        },

        onPomodoroComplete() {
            this.stopPomodoro();
            this.playVictoryFanfare();

            if (this.pomodoroState.mode !== 'break5') {
                this.pomodoroState.streak++;
                localStorage.setItem('cyber_focus_streak', this.pomodoroState.streak.toString());
                const streakCount = document.getElementById('focus-streak-count');
                if (streakCount) {
                    streakCount.textContent = `${this.pomodoroState.streak} Sessions`;
                }
                showActionToast(`🎉 Focus Session Completed! Current streak: ${this.pomodoroState.streak} 🔥`);
            } else {
                showActionToast('☕ Cyber Break Finished! Ready for next Deep Work session.');
            }

            this.resetPomodoro();
        },

        updatePomodoroDisplay() {
            const remaining = this.pomodoroState.remaining;
            const duration = this.pomodoroState.duration;

            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

            const timeDisplay = document.getElementById('pomodoro-time-display');
            if (timeDisplay) timeDisplay.textContent = timeStr;

            // SVG Circular Progress Ring
            const ringProgress = document.getElementById('pomodoro-ring-progress');
            if (ringProgress) {
                const circumference = 640.88; // 2 * PI * 102
                const offset = circumference - (remaining / duration) * circumference;
                ringProgress.style.strokeDashoffset = offset;
            }
        },

        // --- 3. Ambient Lo-Fi Sound Matrix (Web Audio API Synthesizer) ---
        initAudioContext() {
            if (!this.audioCtx) {
                const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
                if (AudioCtxClass) {
                    this.audioCtx = new AudioCtxClass();
                    
                    const masterGain = this.audioCtx.createGain();
                    masterGain.gain.setValueAtTime(0.8, this.audioCtx.currentTime);
                    masterGain.connect(this.audioCtx.destination);
                    this.soundNodes.masterGain = masterGain;
                }
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
        },

        initAudioUI() {
            const masterBtn = document.getElementById('btn-master-sound-toggle');
            if (masterBtn) {
                masterBtn.addEventListener('click', () => {
                    this.initAudioContext();
                    state.soundMasterOn = !state.soundMasterOn;
                    masterBtn.classList.toggle('active', state.soundMasterOn);
                    const label = document.getElementById('master-sound-text');
                    if (label) label.textContent = state.soundMasterOn ? 'AUDIO ACTIVE' : 'AUDIO OFF';
                    
                    const eqBars = document.getElementById('sound-eq-bars');
                    if (eqBars) eqBars.classList.toggle('playing', state.soundMasterOn);
                    
                    const eqLabel = document.getElementById('eq-status-label');
                    if (eqLabel) eqLabel.textContent = state.soundMasterOn ? 'Sound Matrix Active • Synthesizing Waves' : 'Audio Engine Standby';

                    if (state.soundMasterOn) {
                        // Activate default rain if all off
                        if (!state.soundChannels.rain.on && !state.soundChannels.hum.on && !state.soundChannels.gamma.on) {
                            this.toggleChannel('rain', true);
                        }
                    } else {
                        this.stopAllChannels();
                    }
                });
            }

            // Channel Toggles & Sliders
            ['rain', 'hum', 'gamma'].forEach(channel => {
                const toggleBtn = document.getElementById(`btn-toggle-${channel}`);
                const slider = document.getElementById(`slider-vol-${channel}`);
                const valText = document.getElementById(`val-vol-${channel}`);

                if (toggleBtn) {
                    toggleBtn.addEventListener('click', () => {
                        this.initAudioContext();
                        const nextState = !state.soundChannels[channel].on;
                        this.toggleChannel(channel, nextState);
                    });
                }

                if (slider) {
                    slider.addEventListener('input', (e) => {
                        const val = parseInt(e.target.value, 10);
                        state.soundChannels[channel].volume = val / 100;
                        if (valText) valText.textContent = `${val}%`;
                        this.setChannelVolume(channel, val / 100);
                    });
                }
            });

            // Presets
            const presetRain = document.getElementById('preset-rainy-tokyo');
            if (presetRain) {
                presetRain.addEventListener('click', () => {
                    this.applySoundPreset({ rain: 0.8, hum: 0.2, gamma: 0 });
                });
            }

            const presetSpace = document.getElementById('preset-deep-space');
            if (presetSpace) {
                presetSpace.addEventListener('click', () => {
                    this.applySoundPreset({ rain: 0, hum: 0.75, gamma: 0.35 });
                });
            }

            const presetZen = document.getElementById('preset-zen-monk');
            if (presetZen) {
                presetZen.addEventListener('click', () => {
                    this.applySoundPreset({ rain: 0.3, hum: 0.15, gamma: 0.7 });
                });
            }
        },

        applySoundPreset(cfg) {
            this.initAudioContext();
            if (!state.soundMasterOn) {
                const masterBtn = document.getElementById('btn-master-sound-toggle');
                if (masterBtn) masterBtn.click();
            }

            ['rain', 'hum', 'gamma'].forEach(ch => {
                const vol = cfg[ch] || 0;
                const slider = document.getElementById(`slider-vol-${ch}`);
                const valText = document.getElementById(`val-vol-${ch}`);
                if (slider) slider.value = Math.round(vol * 100);
                if (valText) valText.textContent = `${Math.round(vol * 100)}%`;
                state.soundChannels[ch].volume = vol;

                if (vol > 0) {
                    this.toggleChannel(ch, true);
                    this.setChannelVolume(ch, vol);
                } else {
                    this.toggleChannel(ch, false);
                }
            });
            showActionToast('🎛️ Sound Matrix preset loaded.');
        },

        toggleChannel(channel, enable) {
            state.soundChannels[channel].on = enable;
            const card = document.getElementById(`channel-card-${channel}`);
            const btn = document.getElementById(`btn-toggle-${channel}`);

            if (card) card.classList.toggle('active', enable);
            if (btn) {
                btn.classList.toggle('active', enable);
                btn.textContent = enable ? 'ON' : 'OFF';
            }

            if (enable) {
                this.startChannelAudio(channel);
            } else {
                this.stopChannelAudio(channel);
            }
        },

        startChannelAudio(channel) {
            if (!this.audioCtx || !this.soundNodes.masterGain) return;

            if (channel === 'rain') {
                if (this.soundNodes.rain) return;
                // Generate Pink/White Noise Buffer
                const bufferSize = this.audioCtx.sampleRate * 3;
                const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                for (let i = 0; i < bufferSize; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    b3 = 0.86650 * b3 + white * 0.3104856;
                    b4 = 0.55000 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.0168980;
                    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
                    b6 = white * 0.115926;
                }

                const noise = this.audioCtx.createBufferSource();
                noise.buffer = buffer;
                noise.loop = true;

                const filter = this.audioCtx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1000, this.audioCtx.currentTime);
                filter.Q.setValueAtTime(1.0, this.audioCtx.currentTime);

                const gainNode = this.audioCtx.createGain();
                gainNode.gain.setValueAtTime(state.soundChannels.rain.volume, this.audioCtx.currentTime);

                noise.connect(filter);
                filter.connect(gainNode);
                gainNode.connect(this.soundNodes.masterGain);

                noise.start();
                this.soundNodes.rain = { source: noise, gain: gainNode };
            } 
            else if (channel === 'hum') {
                if (this.soundNodes.hum) return;
                // Brown Noise + 60Hz Sub-bass Drone
                const bufferSize = this.audioCtx.sampleRate * 2;
                const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                let lastOut = 0.0;
                for (let i = 0; i < bufferSize; i++) {
                    const white = Math.random() * 2 - 1;
                    data[i] = (lastOut + (0.02 * white)) / 1.02;
                    lastOut = data[i];
                    data[i] *= 1.8;
                }

                const noise = this.audioCtx.createBufferSource();
                noise.buffer = buffer;
                noise.loop = true;

                const filter = this.audioCtx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(160, this.audioCtx.currentTime);

                const osc60 = this.audioCtx.createOscillator();
                osc60.type = 'sine';
                osc60.frequency.setValueAtTime(60, this.audioCtx.currentTime);

                const oscGain = this.audioCtx.createGain();
                oscGain.gain.setValueAtTime(0.35, this.audioCtx.currentTime);
                osc60.connect(oscGain);

                const gainNode = this.audioCtx.createGain();
                gainNode.gain.setValueAtTime(state.soundChannels.hum.volume, this.audioCtx.currentTime);

                noise.connect(filter);
                filter.connect(gainNode);
                oscGain.connect(gainNode);
                gainNode.connect(this.soundNodes.masterGain);

                noise.start();
                osc60.start();
                this.soundNodes.hum = { source: noise, osc: osc60, gain: gainNode };
            } 
            else if (channel === 'gamma') {
                if (this.soundNodes.gamma) return;
                // Binaural 40Hz Gamma Beat: Left 216Hz, Right 256Hz
                const oscLeft = this.audioCtx.createOscillator();
                oscLeft.type = 'sine';
                oscLeft.frequency.setValueAtTime(216, this.audioCtx.currentTime);

                const oscRight = this.audioCtx.createOscillator();
                oscRight.type = 'sine';
                oscRight.frequency.setValueAtTime(256, this.audioCtx.currentTime);

                let pannerLeft = null, pannerRight = null;
                if (this.audioCtx.createStereoPanner) {
                    pannerLeft = this.audioCtx.createStereoPanner();
                    pannerLeft.pan.setValueAtTime(-0.8, this.audioCtx.currentTime);
                    pannerRight = this.audioCtx.createStereoPanner();
                    pannerRight.pan.setValueAtTime(0.8, this.audioCtx.currentTime);
                }

                const gainNode = this.audioCtx.createGain();
                gainNode.gain.setValueAtTime(state.soundChannels.gamma.volume * 0.4, this.audioCtx.currentTime);

                if (pannerLeft && pannerRight) {
                    oscLeft.connect(pannerLeft);
                    pannerLeft.connect(gainNode);
                    oscRight.connect(pannerRight);
                    pannerRight.connect(gainNode);
                } else {
                    oscLeft.connect(gainNode);
                    oscRight.connect(gainNode);
                }

                gainNode.connect(this.soundNodes.masterGain);

                oscLeft.start();
                oscRight.start();
                this.soundNodes.gamma = { oscL: oscLeft, oscR: oscRight, gain: gainNode };
            }
        },

        stopChannelAudio(channel) {
            if (channel === 'rain' && this.soundNodes.rain) {
                try { this.soundNodes.rain.source.stop(); } catch(e){}
                this.soundNodes.rain = null;
            }
            if (channel === 'hum' && this.soundNodes.hum) {
                try {
                    this.soundNodes.hum.source.stop();
                    this.soundNodes.hum.osc.stop();
                } catch(e){}
                this.soundNodes.hum = null;
            }
            if (channel === 'gamma' && this.soundNodes.gamma) {
                try {
                    this.soundNodes.gamma.oscL.stop();
                    this.soundNodes.gamma.oscR.stop();
                } catch(e){}
                this.soundNodes.gamma = null;
            }
        },

        stopAllChannels() {
            ['rain', 'hum', 'gamma'].forEach(ch => {
                this.stopChannelAudio(ch);
                const card = document.getElementById(`channel-card-${ch}`);
                const btn = document.getElementById(`btn-toggle-${ch}`);
                if (card) card.classList.remove('active');
                if (btn) {
                    btn.classList.remove('active');
                    btn.textContent = 'OFF';
                }
                state.soundChannels[ch].on = false;
            });
        },

        setChannelVolume(channel, vol) {
            if (this.soundNodes[channel] && this.soundNodes[channel].gain && this.audioCtx) {
                const finalVol = channel === 'gamma' ? vol * 0.4 : vol;
                this.soundNodes[channel].gain.gain.setValueAtTime(finalVol, this.audioCtx.currentTime);
            }
        },

        playBeep(freq = 440, duration = 0.1, type = 'sine') {
            try {
                this.initAudioContext();
                if (!this.audioCtx) return;
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
                gain.gain.setValueAtTime(0.15, this.audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.start();
                osc.stop(this.audioCtx.currentTime + duration);
            } catch(e){}
        },

        playVictoryFanfare() {
            try {
                this.initAudioContext();
                if (!this.audioCtx) return;
                const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
                notes.forEach((freq, idx) => {
                    setTimeout(() => {
                        this.playBeep(freq, 0.25, 'triangle');
                    }, idx * 120);
                });
            } catch(e){}
        },

        // --- 4. Daily Tech Fortune & Hacker Terminal ---
        initTerminal() {
            const btnNext = document.getElementById('btn-next-tech-quote');
            if (btnNext) {
                btnNext.addEventListener('click', () => {
                    this.showNextQuote();
                });
            }

            const btnCopy = document.getElementById('btn-copy-tech-quote');
            if (btnCopy) {
                btnCopy.addEventListener('click', () => {
                    const quoteItem = this.quotes[this.quoteIndex];
                    if (quoteItem) {
                        const text = `"${quoteItem.quote}" - ${quoteItem.author}`;
                        navigator.clipboard.writeText(text).then(() => {
                            showActionToast('📋 Quote copied to clipboard!');
                        }).catch(() => {
                            showActionToast('Quote copied!');
                        });
                    }
                });
            }

            this.typewriterQuote(this.quotes[0]);
        },

        showNextQuote() {
            this.quoteIndex = (this.quoteIndex + 1) % this.quotes.length;
            this.typewriterQuote(this.quotes[this.quoteIndex]);
            this.playBeep(1200, 0.05, 'sine');
        },

        typewriterQuote(quoteItem) {
            const contentEl = document.getElementById('cyber-quote-content');
            const authorEl = document.getElementById('cyber-quote-author');
            if (!contentEl || !authorEl) return;

            clearInterval(this.typewriterTimer);
            contentEl.textContent = '';
            authorEl.textContent = `~ ${quoteItem.author}`;

            const text = quoteItem.quote;
            let i = 0;

            this.typewriterTimer = setInterval(() => {
                if (i < text.length) {
                    contentEl.textContent += text.charAt(i);
                    i++;
                } else {
                    clearInterval(this.typewriterTimer);
                }
            }, 25);
        }
    };

    // =========================================================================
    // Floating Action Feedback Toast Banner Helper
    // =========================================================================
    function showActionToast(message, isError = false) {
        if (!elements.actionToastContainer) return;

        const toast = document.createElement('div');
        toast.className = `action-toast ${isError ? 'toast-error' : ''}`;
        toast.innerHTML = `
            <span>${escapeHtml(message)}</span>
        `;

        elements.actionToastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => {
                try {
                    toast.remove();
                } catch (e) {}
            }, 300);
        }, 3500);
    }

    // =========================================================================
    // JARVIS VOICE ASSISTANT MANAGER (Web Speech API + Real-time Audio Analyzer)
    // =========================================================================
    const jarvisVoiceManager = {
        isOpen: false,
        isListening: false,
        isSpeaking: false,
        lang: localStorage.getItem('jarvis_lang') || 'vi',
        ttsEnabled: localStorage.getItem('jarvis_tts_enabled') !== 'false',
        recognition: null,
        synth: window.speechSynthesis || null,
        audioCtx: null,
        micStream: null,
        micAnalyser: null,
        micAnimId: null,
        interimTranscript: '',
        finalTranscript: '',

        init() {
            this.cacheDOMElements();
            this.initSpeechRecognition();
            this.bindEvents();
            this.updateLangUI();
            this.updateTTSUI();
        },

        cacheDOMElements() {
            this.dom = {
                hudModal: document.getElementById('jarvis-hud-modal'),
                headerBtn: document.getElementById('btn-header-jarvis-voice'),
                floatingCapsule: document.getElementById('jarvis-floating-capsule'),
                btnCloseHud: document.getElementById('btn-close-jarvis-hud'),
                btnLangVi: document.getElementById('btn-jarvis-lang-vi'),
                btnLangEn: document.getElementById('btn-jarvis-lang-en'),
                btnTtsToggle: document.getElementById('btn-jarvis-tts-toggle'),
                iconTtsOn: document.getElementById('icon-tts-on'),
                iconTtsOff: document.getElementById('icon-tts-off'),
                btnMicTrigger: document.getElementById('btn-jarvis-mic-trigger'),
                statusText: document.getElementById('jarvis-status-text'),
                orbDot: document.getElementById('jarvis-orb-dot'),
                waveBars: document.getElementById('jarvis-wave-bars'),
                stateHint: document.getElementById('jarvis-state-hint'),
                transcriptText: document.getElementById('jarvis-transcript-text'),
                interimBadge: document.getElementById('jarvis-interim-badge'),
                responseSection: document.getElementById('jarvis-response-section'),
                spokenText: document.getElementById('jarvis-spoken-text'),
                displayMarkdown: document.getElementById('jarvis-display-markdown'),
                actionBadge: document.getElementById('jarvis-action-badge'),
                actionBadgeText: document.getElementById('jarvis-action-badge-text'),
                audioSpeakingTag: document.getElementById('jarvis-audio-speaking-tag'),
                textInput: document.getElementById('jarvis-text-input'),
                btnTextSend: document.getElementById('btn-jarvis-text-send'),
            };
        },

        initAudioContext() {
            if (!this.audioCtx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.audioCtx = new AudioCtx();
                }
            }
            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }
        },

        playChime(type = 'activate') {
            try {
                this.initAudioContext();
                if (!this.audioCtx) return;
                const now = this.audioCtx.currentTime;

                if (type === 'activate') {
                    const osc1 = this.audioCtx.createOscillator();
                    const osc2 = this.audioCtx.createOscillator();
                    const gain = this.audioCtx.createGain();

                    osc1.type = 'sine';
                    osc2.type = 'triangle';
                    osc1.frequency.setValueAtTime(587.33, now);
                    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.18);

                    osc2.frequency.setValueAtTime(880, now);
                    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.18);

                    gain.gain.setValueAtTime(0.12, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

                    osc1.connect(gain);
                    osc2.connect(gain);
                    gain.connect(this.audioCtx.destination);

                    osc1.start(now);
                    osc2.start(now);
                    osc1.stop(now + 0.35);
                    osc2.stop(now + 0.35);
                } else if (type === 'success') {
                    const osc = this.audioCtx.createOscillator();
                    const gain = this.audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(659.25, now);
                    osc.frequency.setValueAtTime(987.77, now + 0.08);
                    gain.gain.setValueAtTime(0.15, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                    osc.connect(gain);
                    gain.connect(this.audioCtx.destination);
                    osc.start(now);
                    osc.stop(now + 0.25);
                }
            } catch (e) {}
        },

        initSpeechRecognition() {
            const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRec) {
                console.warn('Web Speech API is not supported in this browser.');
                if (this.dom.stateHint) {
                    this.dom.stateHint.textContent = 'Trình duyệt không hỗ trợ Web Speech API. Bạn có thể gõ câu lệnh bên dưới.';
                }
                return;
            }

            this.recognition = new SpeechRec();
            this.recognition.continuous = false;
            this.recognition.interimResults = true;
            this.recognition.lang = this.lang === 'vi' ? 'vi-VN' : 'en-US';

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateListeningUI(true);
                this.startMicAnalyser();
            };

            this.recognition.onresult = (event) => {
                let interim = '';
                let final = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        final += transcript;
                    } else {
                        interim += transcript;
                    }
                }

                if (interim && this.dom.transcriptText) {
                    this.dom.transcriptText.textContent = `"${interim.trim()}..."`;
                    if (this.dom.interimBadge) this.dom.interimBadge.classList.remove('hidden');
                }

                if (final) {
                    this.finalTranscript = final.trim();
                    if (this.dom.transcriptText) {
                        this.dom.transcriptText.textContent = `"${this.finalTranscript}"`;
                    }
                    if (this.dom.interimBadge) this.dom.interimBadge.classList.add('hidden');
                    this.handleVoiceCommand(this.finalTranscript);
                }
            };

            this.recognition.onerror = (event) => {
                console.warn('Jarvis Speech Recognition error:', event.error);
                this.isListening = false;
                this.stopMicAnalyser();
                this.updateListeningUI(false);

                if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                    const msg = this.lang === 'vi' 
                        ? '⚠️ Trình duyệt chưa cấp quyền Micro! Hãy nhấn vào biểu tượng ổ khóa/micro trên thanh địa chỉ URL để "Cho phép (Allow)".'
                        : '⚠️ Microphone permission denied! Please allow microphone access in your browser address bar.';
                    if (this.dom.stateHint) this.dom.stateHint.textContent = msg;
                    if (this.dom.transcriptText) this.dom.transcriptText.textContent = msg;
                    showActionToast('⚠️ Hãy cấp quyền Microphone cho trình duyệt', true);
                } else if (event.error === 'no-speech') {
                    const msg = this.lang === 'vi'
                        ? 'Không nhận được tiếng nói. Bạn có thể nhấn vào Micro để nói lại, hoặc bấm vào các nút gợi ý bên dưới.'
                        : 'No speech detected. Click the Mic to try again or click suggestion chips below.';
                    if (this.dom.stateHint) this.dom.stateHint.textContent = msg;
                } else if (event.error === 'network') {
                    const msg = this.lang === 'vi'
                        ? '⚠️ Lỗi mạng Web Speech. Trình duyệt cần kết nối internet để chuyển giọng nói thành chữ. Bạn có thể gõ câu lệnh vào ô bên dưới.'
                        : '⚠️ Web Speech network error. Please check your internet connection or use text input.';
                    if (this.dom.stateHint) this.dom.stateHint.textContent = msg;
                }
            };

            this.recognition.onend = () => {
                this.isListening = false;
                this.stopMicAnalyser();
                if (!this.isSpeaking) {
                    this.updateListeningUI(false);
                }
            };
        },

        startMicAnalyser() {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
            this.initAudioContext();
            if (!this.audioCtx) return;

            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    this.micStream = stream;
                    const source = this.audioCtx.createMediaStreamSource(stream);
                    const analyser = this.audioCtx.createAnalyser();
                    analyser.fftSize = 64;
                    source.connect(analyser);
                    this.micAnalyser = analyser;

                    const dataArray = new Uint8Array(analyser.frequencyBinCount);
                    const bars = this.dom.waveBars ? this.dom.waveBars.querySelectorAll('.wave-bar') : [];

                    const updateBars = () => {
                        if (!this.isListening) return;
                        analyser.getByteFrequencyData(dataArray);

                        let sum = 0;
                        for (let i = 0; i < bars.length; i++) {
                            const val = dataArray[i * 2] || 0;
                            sum += val;
                            const height = Math.max(6, Math.min(32, (val / 255) * 32));
                            bars[i].style.height = `${height}px`;
                        }

                        // If user is actively making sound, pulse the mic button
                        if (this.dom.btnMicTrigger) {
                            if (sum > 200) {
                                this.dom.btnMicTrigger.style.transform = 'scale(1.15)';
                            } else {
                                this.dom.btnMicTrigger.style.transform = 'scale(1.05)';
                            }
                        }

                        this.micAnimId = requestAnimationFrame(updateBars);
                    };
                    this.micAnimId = requestAnimationFrame(updateBars);
                })
                .catch(err => {
                    console.warn('Could not access microphone hardware stream:', err);
                });
        },

        stopMicAnalyser() {
            if (this.micAnimId) {
                cancelAnimationFrame(this.micAnimId);
                this.micAnimId = null;
            }
            if (this.micStream) {
                this.micStream.getTracks().forEach(track => track.stop());
                this.micStream = null;
            }
            if (this.dom.waveBars) {
                const bars = this.dom.waveBars.querySelectorAll('.wave-bar');
                bars.forEach(b => b.style.height = '6px');
            }
            if (this.dom.btnMicTrigger) {
                this.dom.btnMicTrigger.style.transform = '';
            }
        },

        bindEvents() {
            // Trigger Open
            if (this.dom.headerBtn) {
                this.dom.headerBtn.addEventListener('click', () => this.toggleHUD());
            }
            if (this.dom.floatingCapsule) {
                this.dom.floatingCapsule.addEventListener('click', () => this.toggleHUD());
            }
            if (this.dom.btnCloseHud) {
                this.dom.btnCloseHud.addEventListener('click', () => this.closeHUD());
            }

            // Global Keyboard Shortcut: Alt + J or Ctrl + Space
            document.addEventListener('keydown', (e) => {
                if ((e.altKey && (e.key === 'j' || e.key === 'J')) || (e.ctrlKey && e.code === 'Space')) {
                    if (window.featureManager && window.featureManager.config && window.featureManager.config.ai_jarvis_voice === false) {
                        return; // Jarvis is disabled in Module Control Center
                    }
                    e.preventDefault();
                    this.toggleHUD();
                } else if (e.key === 'Escape' && this.isOpen) {
                    this.closeHUD();
                }
            });

            // Mic Trigger Button
            if (this.dom.btnMicTrigger) {
                this.dom.btnMicTrigger.addEventListener('click', () => {
                    if (this.isListening) {
                        this.stopListening();
                    } else {
                        this.startListening();
                    }
                });
            }

            // Language Switcher
            if (this.dom.btnLangVi) {
                this.dom.btnLangVi.addEventListener('click', () => this.setLanguage('vi'));
            }
            if (this.dom.btnLangEn) {
                this.dom.btnLangEn.addEventListener('click', () => this.setLanguage('en'));
            }

            // TTS Audio Toggle
            if (this.dom.btnTtsToggle) {
                this.dom.btnTtsToggle.addEventListener('click', () => this.toggleTTS());
            }

            // Quick Prompt Chips -> Execute immediately
            document.querySelectorAll('.jarvis-prompt-chip').forEach(chip => {
                chip.addEventListener('click', () => {
                    const cmd = chip.getAttribute('data-cmd');
                    if (cmd) {
                        if (this.dom.transcriptText) {
                            this.dom.transcriptText.textContent = `"${cmd}"`;
                        }
                        this.handleVoiceCommand(cmd);
                    }
                });
            });

            // Text Input Fallback -> Execute immediately
            if (this.dom.btnTextSend && this.dom.textInput) {
                this.dom.btnTextSend.addEventListener('click', () => {
                    const val = this.dom.textInput.value.trim();
                    if (val) {
                        this.dom.textInput.value = '';
                        this.handleVoiceCommand(val);
                    }
                });

                this.dom.textInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = this.dom.textInput.value.trim();
                        if (val) {
                            this.dom.textInput.value = '';
                            this.handleVoiceCommand(val);
                        }
                    }
                });
            }
        },

        toggleHUD() {
            if (this.isOpen) {
                this.closeHUD();
            } else {
                this.openHUD();
            }
        },

        openHUD() {
            this.isOpen = true;
            if (this.dom.hudModal) {
                this.dom.hudModal.classList.remove('hidden');
            }
            this.playChime('activate');
            if (this.dom.transcriptText) {
                this.dom.transcriptText.textContent = this.lang === 'vi' 
                    ? '"Sẵn sàng lắng nghe... Hãy nói câu lệnh của bạn!"'
                    : '"Listening... Please speak your command!"';
            }
            setTimeout(() => {
                this.startListening();
            }, 250);
        },

        closeHUD() {
            this.isOpen = false;
            this.stopListening();
            this.stopSpeaking();
            if (this.dom.hudModal) {
                this.dom.hudModal.classList.add('hidden');
            }
        },

        setLanguage(lang) {
            this.lang = lang;
            localStorage.setItem('jarvis_lang', lang);
            if (this.recognition) {
                this.recognition.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
            }
            this.updateLangUI();
            if (this.dom.transcriptText) {
                this.dom.transcriptText.textContent = lang === 'vi' 
                    ? '"Đã chuyển sang Tiếng Việt. Sẵn sàng lắng nghe..."' 
                    : '"Switched to English. Ready to listen..."';
            }
        },

        updateLangUI() {
            if (this.dom.btnLangVi && this.dom.btnLangEn) {
                this.dom.btnLangVi.classList.toggle('active', this.lang === 'vi');
                this.dom.btnLangEn.classList.toggle('active', this.lang === 'en');
            }
        },

        toggleTTS() {
            this.ttsEnabled = !this.ttsEnabled;
            localStorage.setItem('jarvis_tts_enabled', this.ttsEnabled ? 'true' : 'false');
            this.updateTTSUI();
            if (!this.ttsEnabled) {
                this.stopSpeaking();
            }
        },

        updateTTSUI() {
            if (this.dom.btnTtsToggle) {
                this.dom.btnTtsToggle.classList.toggle('active', this.ttsEnabled);
                if (this.dom.iconTtsOn && this.dom.iconTtsOff) {
                    this.dom.iconTtsOn.classList.toggle('hidden', !this.ttsEnabled);
                    this.dom.iconTtsOff.classList.toggle('hidden', this.ttsEnabled);
                }
            }
        },

        startListening() {
            if (!this.recognition) {
                if (this.dom.stateHint) this.dom.stateHint.textContent = 'Speech Recognition không khả dụng. Dùng ô nhập text.';
                return;
            }
            this.stopSpeaking();
            try {
                this.recognition.start();
            } catch (e) {
                // Already started or busy
            }
        },

        stopListening() {
            if (this.recognition) {
                try {
                    this.recognition.stop();
                } catch (e) {}
            }
            this.stopMicAnalyser();
            this.isListening = false;
            this.updateListeningUI(false);
        },

        updateListeningUI(listening) {
            if (this.dom.btnMicTrigger) {
                this.dom.btnMicTrigger.classList.toggle('listening', listening);
            }
            if (this.dom.orbDot) {
                this.dom.orbDot.className = `orb-pulse-dot ${listening ? 'listening' : ''}`;
            }
            if (this.dom.statusText) {
                this.dom.statusText.textContent = listening 
                    ? (this.lang === 'vi' ? '🔴 ĐANG THU ÂM (NÓI BÂY GIỜ...)' : '🔴 RECORDING (SPEAK NOW...)') 
                    : (this.isSpeaking ? (this.lang === 'vi' ? '🔊 ĐANG TRẢ LỜI...' : '🔊 SPEAKING...') : 'JARVIS READY');
            }
            if (this.dom.waveBars) {
                this.dom.waveBars.classList.toggle('active', listening || this.isSpeaking);
            }
            if (this.dom.stateHint) {
                this.dom.stateHint.textContent = listening 
                    ? (this.lang === 'vi' ? '🎙️ Micro đang mở! Hãy nói câu lệnh của bạn...' : '🎙️ Microphone active! Speak your command...') 
                    : (this.lang === 'vi' ? 'Nhấn vào Micro để bắt đầu thu âm hoặc bấm vào gợi ý bên dưới' : 'Click the Microphone to start recording or select a prompt below');
            }
        },

        async handleVoiceCommand(query) {
            if (!query || !query.trim()) return;

            this.stopListening();
            this.updateStatus('THINKING...', 'thinking');
            if (this.dom.stateHint) {
                this.dom.stateHint.textContent = this.lang === 'vi' ? '⚡ Đang phân tích câu lệnh và xử lý hệ thống...' : '⚡ Processing command...';
            }

            try {
                const res = await fetch('/api/voice/command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: query, lang: this.lang })
                });

                if (!res.ok) throw new Error('API response not ok');
                const data = await res.json();

                this.renderResponse(data);
                this.playChime('success');

                // Dispatch client-side actions
                if (data.action) {
                    this.executeClientAction(data.action, data.action_payload, data.action_result);
                }

                // Speak answer
                if (this.ttsEnabled && data.spoken_response) {
                    this.speak(data.spoken_response);
                } else {
                    this.updateStatus('JARVIS READY', 'ready');
                    if (this.dom.stateHint) {
                        this.dom.stateHint.textContent = this.lang === 'vi' ? 'Hoàn tất! Nhấn Micro để ra lệnh tiếp theo.' : 'Completed! Click Mic to give another command.';
                    }
                }
            } catch (e) {
                console.error('Error in Jarvis voice command:', e);
                if (this.dom.responseSection) {
                    this.dom.responseSection.classList.remove('hidden');
                    if (this.dom.spokenText) this.dom.spokenText.textContent = 'Xin lỗi, đã xảy ra lỗi khi xử lý câu lệnh.';
                    if (this.dom.displayMarkdown) this.dom.displayMarkdown.textContent = 'Vui lòng kiểm tra kết nối mạng hoặc thử lại.';
                }
                this.updateStatus('JARVIS READY', 'ready');
            }
        },

        renderResponse(data) {
            if (!this.dom.responseSection) return;
            this.dom.responseSection.classList.remove('hidden');

            if (this.dom.spokenText) {
                this.dom.spokenText.textContent = data.spoken_response || '';
            }

            if (this.dom.displayMarkdown) {
                this.dom.displayMarkdown.innerHTML = renderMarkdownSimple(data.display_text || '');
            }

            if (this.dom.actionBadge) {
                if (data.action) {
                    this.dom.actionBadge.classList.remove('hidden');
                    if (this.dom.actionBadgeText) {
                        this.dom.actionBadgeText.textContent = data.action.toUpperCase().replace('_', ' ');
                    }
                } else {
                    this.dom.actionBadge.classList.add('hidden');
                }
            }
        },

        executeClientAction(action, payload = {}, result = {}) {
            if (action === 'navigate_tab') {
                const targetTab = payload.tab || 'overview';
                switchTab(targetTab);
                showActionToast(`🚀 Jarvis: Chuyển sang Tab ${targetTab.toUpperCase()}`);
            } else if (action === 'toggle_theme') {
                toggleTheme();
                showActionToast('🌓 Jarvis: Đã chuyển đổi giao diện Theme');
            } else if (action === 'engage_focus') {
                switchTab('focus');
                showActionToast('🎯 Jarvis: Kích hoạt Cyber Focus Matrix');
            } else if (action === 'clean_temp') {
                const freed = result && result.freed_mb ? `${result.freed_mb} MB` : '';
                showActionToast(`🧹 Jarvis: Dọn dẹp thành công ${freed}`);
            } else if (action === 'flush_dns') {
                showActionToast('⚡ Jarvis: Làm mới DNS Resolver Cache thành công');
            }
        },

        speak(text) {
            if (!this.synth || !this.ttsEnabled) return;
            this.synth.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = this.lang === 'vi' ? 'vi-VN' : 'en-US';
            utterance.rate = 1.05;
            utterance.pitch = 1.0;

            const voices = this.synth.getVoices();
            if (voices && voices.length > 0) {
                const langCode = this.lang === 'vi' ? 'vi' : 'en';
                const matchedVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langCode));
                if (matchedVoice) {
                    utterance.voice = matchedVoice;
                }
            }

            utterance.onstart = () => {
                this.isSpeaking = true;
                this.updateStatus('SPEAKING...', 'speaking');
                if (this.dom.audioSpeakingTag) this.dom.audioSpeakingTag.classList.remove('hidden');
                if (this.dom.waveBars) this.dom.waveBars.classList.add('active');
                if (this.dom.stateHint) {
                    this.dom.stateHint.textContent = this.lang === 'vi' ? '🔊 Jarvis đang đọc phản hồi...' : '🔊 Jarvis is speaking...';
                }
            };

            utterance.onend = () => {
                this.isSpeaking = false;
                if (this.dom.audioSpeakingTag) this.dom.audioSpeakingTag.classList.add('hidden');
                if (this.dom.waveBars) this.dom.waveBars.classList.remove('active');
                this.updateStatus('JARVIS READY', 'ready');
                if (this.dom.stateHint) {
                    this.dom.stateHint.textContent = this.lang === 'vi' ? 'Nhấn vào Micro để ra lệnh tiếp theo' : 'Click Mic to give another command';
                }
            };

            utterance.onerror = () => {
                this.isSpeaking = false;
                if (this.dom.audioSpeakingTag) this.dom.audioSpeakingTag.classList.add('hidden');
                if (this.dom.waveBars) this.dom.waveBars.classList.remove('active');
                this.updateStatus('JARVIS READY', 'ready');
            };

            this.synth.speak(utterance);
        },

        stopSpeaking() {
            if (this.synth) {
                this.synth.cancel();
            }
            this.isSpeaking = false;
            if (this.dom.audioSpeakingTag) this.dom.audioSpeakingTag.classList.add('hidden');
            if (this.dom.waveBars) this.dom.waveBars.classList.remove('active');
        },

        updateStatus(text, type = 'ready') {
            if (this.dom.statusText) this.dom.statusText.textContent = text;
            if (this.dom.orbDot) {
                this.dom.orbDot.className = `orb-pulse-dot ${type}`;
            }
        }
    };

    // =========================================================================
    // NETWORK & LAN RADAR MANAGER (Canvas 360° Sweep, LAN & Sockets Tracking)
    // =========================================================================
    const networkRadarManager = {
        mode: 'lan', // 'lan' or 'sockets'
        devices: [],
        connections: [],
        selectedDevice: null,
        isScanning: false,
        sweepAngle: 0,
        animId: null,
        canvas: null,
        ctx: null,
        hoverTarget: null,
        mousePos: { x: -1, y: -1 },

        init() {
            this.cacheDOMElements();
            this.setupCanvas();
            this.bindEvents();
            window.networkRadarManager = this;
        },

        cacheDOMElements() {
            this.dom = {
                btnScanNow: document.getElementById('btn-radar-scan-now'),
                btnModeLan: document.getElementById('btn-radar-mode-lan'),
                btnModeSockets: document.getElementById('btn-radar-mode-sockets'),
                kpiDevicesCount: document.getElementById('radar-kpi-devices-count'),
                kpiSubnet: document.getElementById('radar-kpi-subnet'),
                kpiGatewayPing: document.getElementById('radar-kpi-gateway-ping'),
                kpiGatewayIp: document.getElementById('radar-kpi-gateway-ip'),
                kpiWifiSignal: document.getElementById('radar-kpi-wifi-signal'),
                kpiWifiSsid: document.getElementById('radar-kpi-wifi-ssid'),
                kpiSocketsCount: document.getElementById('radar-kpi-sockets-count'),
                kpiListenCount: document.getElementById('radar-kpi-listen-count'),
                coordsTag: document.getElementById('radar-coords-tag'),
                canvasContainer: document.getElementById('radar-canvas-container'),
                canvas: document.getElementById('radar-canvas'),
                tooltip: document.getElementById('radar-hover-tooltip'),
                tooltipTitle: document.getElementById('tooltip-title'),
                tooltipIp: document.getElementById('tooltip-ip'),
                tooltipDetail: document.getElementById('tooltip-detail'),
                inspectorName: document.getElementById('inspector-device-name'),
                inspectorType: document.getElementById('inspector-device-type'),
                inspectorIp: document.getElementById('inspector-ip'),
                inspectorMac: document.getElementById('inspector-mac'),
                inspectorVendor: document.getElementById('inspector-vendor'),
                inspectorPing: document.getElementById('inspector-ping'),
                inspectorTier: document.getElementById('inspector-tier'),
                inspectorCoords: document.getElementById('inspector-coords'),
                btnInspectorPing: document.getElementById('btn-inspector-ping'),
                btnInspectorCopy: document.getElementById('btn-inspector-copy'),
                consoleOutput: document.getElementById('inspector-console-output'),
                tableHeading: document.getElementById('radar-table-heading'),
                tableCountPill: document.getElementById('radar-table-count-pill'),
                searchInput: document.getElementById('radar-search-input'),
                tbody: document.getElementById('radar-devices-tbody'),
            };
        },

        setupCanvas() {
            if (!this.dom.canvas) return;
            this.canvas = this.dom.canvas;
            this.ctx = this.canvas.getContext('2d');
            this.resizeCanvas();
        },

        resizeCanvas() {
            if (!this.canvas) return;
            const size = 500;
            this.canvas.width = size;
            this.canvas.height = size;
        },

        bindEvents() {
            if (this.dom.btnScanNow) {
                this.dom.btnScanNow.addEventListener('click', () => this.fetchRadarData(true));
            }

            if (this.dom.btnModeLan) {
                this.dom.btnModeLan.addEventListener('click', () => this.setMode('lan'));
            }

            if (this.dom.btnModeSockets) {
                this.dom.btnModeSockets.addEventListener('click', () => this.setMode('sockets'));
            }

            if (this.dom.btnInspectorPing) {
                this.dom.btnInspectorPing.addEventListener('click', () => {
                    if (this.selectedDevice && this.selectedDevice.ip) {
                        this.pingTarget(this.selectedDevice.ip);
                    } else if (this.selectedDevice && this.selectedDevice.remote_ip) {
                        this.pingTarget(this.selectedDevice.remote_ip);
                    } else {
                        showActionToast('Vui lòng chọn 1 thiết bị trên Radar trước');
                    }
                });
            }

            if (this.dom.btnInspectorCopy) {
                this.dom.btnInspectorCopy.addEventListener('click', () => {
                    const targetIp = this.selectedDevice ? (this.selectedDevice.ip || this.selectedDevice.remote_ip) : null;
                    if (targetIp) {
                        navigator.clipboard.writeText(targetIp);
                        showActionToast(`📋 Đã copy IP: ${targetIp}`);
                    }
                });
            }

            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', () => this.renderTable());
            }

            // Canvas Mouse Interaction (Hover tooltip & Click inspector)
            if (this.canvas) {
                this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
                this.canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
                this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
            }
        },

        setMode(mode) {
            this.mode = mode;
            if (this.dom.btnModeLan && this.dom.btnModeSockets) {
                this.dom.btnModeLan.classList.toggle('active', mode === 'lan');
                this.dom.btnModeSockets.classList.toggle('active', mode === 'sockets');
            }
            if (this.dom.tableHeading) {
                this.dom.tableHeading.textContent = mode === 'lan' 
                    ? 'Discovered LAN Devices (Subnet Neighborhood)'
                    : 'Active Outbound Socket Connections (By Process)';
            }
            this.renderTable();
        },

        onTabActivated() {
            this.fetchRadarData(false);
            this.startSweepAnimation();
        },

        onTabDeactivated() {
            this.stopSweepAnimation();
        },

        startSweepAnimation() {
            if (this.animId) return;
            const animate = () => {
                this.sweepAngle = (this.sweepAngle + 1.8) % 360;
                this.drawRadar();
                if (this.dom.coordsTag) {
                    const padAng = String(Math.floor(this.sweepAngle)).padStart(3, '0');
                    this.dom.coordsTag.textContent = `ANG: ${padAng}° • RANGE: 100m • SCAN: OK`;
                }
                this.animId = requestAnimationFrame(animate);
            };
            this.animId = requestAnimationFrame(animate);
        },

        stopSweepAnimation() {
            if (this.animId) {
                cancelAnimationFrame(this.animId);
                this.animId = null;
            }
        },

        async fetchRadarData(force = false) {
            this.isScanning = true;
            if (this.dom.btnScanNow) this.dom.btnScanNow.disabled = true;

            try {
                const [lanRes, connRes, wifiRes] = await Promise.all([
                    fetch(`/api/radar/lan-devices?force=${force}`).then(r => r.json()),
                    fetch('/api/radar/connections').then(r => r.json()),
                    fetch('/api/radar/wifi-info').then(r => r.json())
                ]);

                if (lanRes && lanRes.devices) {
                    this.devices = lanRes.devices;
                    if (this.dom.kpiDevicesCount) this.dom.kpiDevicesCount.textContent = lanRes.total_devices || this.devices.length;
                    if (this.dom.kpiSubnet) this.dom.kpiSubnet.textContent = lanRes.subnet || '192.168.1.0/24';
                    if (this.dom.kpiGatewayIp) this.dom.kpiGatewayIp.textContent = lanRes.gateway_ip || '192.168.1.1';
                    
                    const gw = this.devices.find(d => d.is_gateway);
                    if (this.dom.kpiGatewayPing) this.dom.kpiGatewayPing.textContent = gw ? (gw.ping_ms || 1) : 1;

                    // If nothing selected yet, select Gateway or Local PC
                    if (!this.selectedDevice && this.devices.length > 0) {
                        this.selectDevice(this.devices[0]);
                    }
                }

                if (connRes) {
                    this.connections = connRes.connections || [];
                    if (this.dom.kpiSocketsCount) this.dom.kpiSocketsCount.textContent = connRes.total_connections || 0;
                    if (this.dom.kpiListenCount) this.dom.kpiListenCount.textContent = `${connRes.total_listening || 0} ports`;
                }

                if (wifiRes) {
                    if (this.dom.kpiWifiSignal) this.dom.kpiWifiSignal.textContent = wifiRes.signal_percent || 100;
                    if (this.dom.kpiWifiSsid) this.dom.kpiWifiSsid.textContent = wifiRes.ssid || 'Ethernet / Wi-Fi';
                }

                this.logConsole(`[${new Date().toLocaleTimeString()}] Subnet scan complete: ${this.devices.length} LAN nodes found, ${this.connections.length} socket flows active.`);
                this.renderTable();
            } catch (err) {
                console.error('Error fetching radar data:', err);
                this.logConsole(`[${new Date().toLocaleTimeString()}] Error scanning network: ${err.message}`);
            } finally {
                this.isScanning = false;
                if (this.dom.btnScanNow) this.dom.btnScanNow.disabled = false;
            }
        },

        drawRadar() {
            if (!this.ctx || !this.canvas) return;
            const ctx = this.ctx;
            const w = this.canvas.width;
            const h = this.canvas.height;
            const cx = w / 2;
            const cy = h / 2;
            const maxR = (w / 2) - 30;

            ctx.clearRect(0, 0, w, h);

            // 1. Draw Concentric Range Rings
            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            const ringColor = isDark ? 'rgba(16, 185, 129, 0.25)' : 'rgba(16, 185, 129, 0.35)';
            const subRingColor = isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.18)';
            const textColor = isDark ? 'rgba(16, 185, 129, 0.7)' : '#047857';

            [0.25, 0.5, 0.75, 1.0].forEach((ratio, i) => {
                ctx.beginPath();
                ctx.arc(cx, cy, maxR * ratio, 0, Math.PI * 2);
                ctx.strokeStyle = i === 3 ? ringColor : subRingColor;
                ctx.lineWidth = i === 3 ? 1.8 : 1;
                ctx.stroke();

                // Range Labels
                ctx.fillStyle = textColor;
                ctx.font = '10px "JetBrains Mono", monospace';
                ctx.fillText(`${Math.round(ratio * 100)}m`, cx + (maxR * ratio) - 15, cy - 4);
            });

            // 2. Crosshair Grid Lines (Horizontal, Vertical)
            ctx.beginPath();
            ctx.moveTo(cx - maxR, cy); ctx.lineTo(cx + maxR, cy);
            ctx.moveTo(cx, cy - maxR); ctx.lineTo(cx, cy + maxR);
            ctx.strokeStyle = subRingColor;
            ctx.lineWidth = 1;
            ctx.stroke();

            // 3. Coordinate Cardinal Points (000°, 090°, 180°, 270°)
            ctx.fillStyle = textColor;
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText('N • 000°', cx, cy - maxR - 8);
            ctx.fillText('S • 180°', cx, cy + maxR + 16);
            ctx.fillText('E • 090°', cx + maxR + 16, cy + 3);
            ctx.fillText('W • 270°', cx - maxR - 16, cy + 3);

            // 4. Sweeping Sonar Beam with Phosphor Trail
            const sweepRad = (this.sweepAngle - 90) * (Math.PI / 180);
            const trailAngle = 45 * (Math.PI / 180);

            const beamGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
            beamGrad.addColorStop(0, 'rgba(16, 185, 129, 0.25)');
            beamGrad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, maxR, sweepRad - trailAngle, sweepRad, false);
            ctx.closePath();
            ctx.fillStyle = beamGrad;
            ctx.fill();

            // Leading Laser Line
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(sweepRad) * maxR, cy + Math.sin(sweepRad) * maxR);
            ctx.strokeStyle = '#34d399';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 10;
            ctx.stroke();
            ctx.restore();

            // 5. Draw Target Blips
            const targetList = (this.mode === 'lan') ? this.devices : this.connections;
            this.hoverTarget = null;

            targetList.forEach((d, idx) => {
                let deg = 0;
                let rPct = 0;

                if (this.mode === 'lan') {
                    deg = d.angle_deg || 0;
                    rPct = d.radius_pct || 0;
                } else {
                    // For sockets: distribute radially around ports
                    deg = (idx * 28) % 360;
                    rPct = Math.min(90, 30 + ((idx * 7) % 55));
                }

                const rad = (deg - 90) * (Math.PI / 180);
                const r = (rPct / 100) * maxR;
                const bx = cx + Math.cos(rad) * r;
                const by = cy + Math.sin(rad) * r;

                d._canvasX = bx;
                d._canvasY = by;

                // Color code
                let blipColor = '#10b981'; // Green for router/general
                if (d.is_local) blipColor = '#38bdf8'; // Blue for PC
                else if (d.icon === 'phone' || (d.category && d.category.includes('Messaging'))) blipColor = '#c084fc';
                else if (d.icon === 'iot' || (d.category && d.category.includes('Gaming'))) blipColor = '#fbbf24';

                const isSelected = this.selectedDevice && (this.selectedDevice.ip === d.ip || this.selectedDevice.remote_addr === d.remote_addr);

                // Pulsing ring if selected
                if (isSelected) {
                    ctx.beginPath();
                    ctx.arc(bx, by, 12, 0, Math.PI * 2);
                    ctx.strokeStyle = blipColor;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                // Solid Core Dot
                ctx.beginPath();
                ctx.arc(bx, by, d.is_local ? 6 : 5, 0, Math.PI * 2);
                ctx.fillStyle = blipColor;
                ctx.shadowColor = blipColor;
                ctx.shadowBlur = isSelected ? 16 : 8;
                ctx.fill();
                ctx.shadowBlur = 0;

                // Blip Small Label
                ctx.fillStyle = isDark ? '#e2e8f0' : '#1e293b';
                ctx.font = '9px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                const label = d.is_local ? 'YOU (PC)' : (d.is_gateway ? 'ROUTER' : (d.device_name ? d.device_name.substring(0, 14) : (d.process_name || d.ip || '')));
                ctx.fillText(label, bx, by - 8);

                // Mouse Hover Check
                if (this.mousePos.x >= 0) {
                    const dist = Math.hypot(this.mousePos.x - bx, this.mousePos.y - by);
                    if (dist <= 14) {
                        this.hoverTarget = d;
                    }
                }
            });

            this.updateTooltip();
        },

        handleMouseMove(e) {
            const rect = this.canvas.getBoundingClientRect();
            this.mousePos = {
                x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
                y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
            };
        },

        handleMouseLeave() {
            this.mousePos = { x: -1, y: -1 };
            this.hoverTarget = null;
            this.updateTooltip();
        },

        handleCanvasClick(e) {
            if (this.hoverTarget) {
                this.selectDevice(this.hoverTarget);
            }
        },

        updateTooltip() {
            if (!this.dom.tooltip) return;
            if (this.hoverTarget) {
                const d = this.hoverTarget;
                this.dom.tooltipTitle.textContent = d.device_name || d.process_name || 'Network Node';
                this.dom.tooltipIp.textContent = d.ip || d.remote_addr || '--';
                this.dom.tooltipDetail.textContent = d.vendor || d.category || (d.ping_ms !== undefined ? `Ping: ${d.ping_ms}ms` : 'Active Socket');
                
                const rect = this.canvas.getBoundingClientRect();
                const scaleX = rect.width / this.canvas.width;
                const scaleY = rect.height / this.canvas.height;
                const tipX = (d._canvasX * scaleX) + 12;
                const tipY = (d._canvasY * scaleY) - 20;

                this.dom.tooltip.style.left = `${tipX}px`;
                this.dom.tooltip.style.top = `${tipY}px`;
                this.dom.tooltip.classList.remove('hidden');
            } else {
                this.dom.tooltip.classList.add('hidden');
            }
        },

        selectDevice(d) {
            this.selectedDevice = d;
            if (!d) return;

            if (this.dom.inspectorName) this.dom.inspectorName.textContent = d.device_name || d.process_name || d.ip;
            if (this.dom.inspectorType) this.dom.inspectorType.textContent = d.is_local ? 'Host Machine (Current PC)' : (d.is_gateway ? 'Default Gateway Router' : (d.category || d.vendor || 'Discovered LAN Device'));
            if (this.dom.inspectorIp) this.dom.inspectorIp.textContent = d.ip || d.remote_addr || '--';
            if (this.dom.inspectorMac) this.dom.inspectorMac.textContent = d.mac || (d.local_addr ? `Local: ${d.local_addr}` : '--');
            if (this.dom.inspectorVendor) this.dom.inspectorVendor.textContent = d.vendor || d.service || '--';
            if (this.dom.inspectorPing) this.dom.inspectorPing.textContent = d.ping_ms !== undefined ? `${d.ping_ms} ms` : (d.status || '--');
            if (this.dom.inspectorTier) this.dom.inspectorTier.textContent = d.is_local ? 'Tier 0 (Local Host)' : (d.is_gateway ? 'Tier 1 (Gateway Router)' : 'Tier 2 (Subnet Node)');
            if (this.dom.inspectorCoords) this.dom.inspectorCoords.textContent = `Angle: ${d.angle_deg || 0}° • Radius: ${d.radius_pct || 0}%`;

            this.logConsole(`[${new Date().toLocaleTimeString()}] Inspected target: ${d.ip || d.remote_addr} (${d.vendor || d.process_name || 'Node'})`);
        },

        async pingTarget(ip) {
            this.logConsole(`[${new Date().toLocaleTimeString()}] Pinging target ${ip}...`);
            showActionToast(`📡 Đang gửi gói tin Ping tới ${ip}...`);
            try {
                const res = await fetch('/api/radar/ping', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ip: ip })
                });
                const data = await res.json();
                if (data.online) {
                    this.logConsole(`[${new Date().toLocaleTimeString()}] Ping reply from ${ip}: time=${data.ping_ms}ms (Online)`);
                    showActionToast(`✅ Ping ${ip}: ${data.ping_ms}ms`);
                    if (this.selectedDevice && (this.selectedDevice.ip === ip || this.selectedDevice.remote_ip === ip)) {
                        this.selectedDevice.ping_ms = data.ping_ms;
                        if (this.dom.inspectorPing) this.dom.inspectorPing.textContent = `${data.ping_ms} ms`;
                    }
                } else {
                    this.logConsole(`[${new Date().toLocaleTimeString()}] Ping ${ip} timed out (Unreachable/Filtered)`);
                    showActionToast(`⚠️ Ping ${ip} không phản hồi`, true);
                }
            } catch (e) {
                this.logConsole(`[${new Date().toLocaleTimeString()}] Ping request error: ${e.message}`);
            }
        },

        logConsole(msg) {
            if (!this.dom.consoleOutput) return;
            const div = document.createElement('div');
            div.textContent = msg;
            this.dom.consoleOutput.appendChild(div);
            this.dom.consoleOutput.scrollTop = this.dom.consoleOutput.scrollHeight;
        },

        selectDeviceByIp(ip) {
            const d = this.devices.find(item => item.ip === ip) || this.connections.find(item => item.remote_ip === ip);
            if (d) {
                this.selectDevice(d);
                showActionToast(`🎯 Đã khóa mục tiêu trên Radar: ${d.device_name || d.ip}`);
                if (this.dom.canvasContainer) {
                    this.dom.canvasContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        },

        renderTable() {
            if (!this.dom.tbody) return;
            const q = (this.dom.searchInput ? this.dom.searchInput.value : '').toLowerCase().trim();

            if (this.mode === 'lan') {
                let filtered = this.devices.filter(d => {
                    if (!q) return true;
                    return (d.ip && d.ip.includes(q)) ||
                           (d.mac && d.mac.toLowerCase().includes(q)) ||
                           (d.device_name && d.device_name.toLowerCase().includes(q)) ||
                           (d.vendor && d.vendor.toLowerCase().includes(q)) ||
                           (d.category && d.category.toLowerCase().includes(q));
                });

                if (this.dom.tableCountPill) {
                    this.dom.tableCountPill.textContent = `${filtered.length} Devices Online`;
                }

                if (filtered.length === 0) {
                    this.dom.tbody.innerHTML = `<tr><td colspan="6" class="loading-state">Không tìm thấy thiết bị nào khớp với từ khóa tìm kiếm.</td></tr>`;
                    return;
                }

                this.dom.tbody.innerHTML = filtered.map(d => {
                    const isSelected = this.selectedDevice && this.selectedDevice.ip === d.ip;
                    const pingVal = d.ping_ms !== undefined ? d.ping_ms : 1;
                    const isUltra = pingVal <= 5;
                    const isGood = pingVal <= 30;
                    
                    const roleColor = d.is_local ? '#38bdf8' : (d.is_gateway ? '#10b981' : '#c084fc');
                    const roleBorder = d.is_local ? 'rgba(56, 189, 248, 0.35)' : (d.is_gateway ? 'rgba(16, 185, 129, 0.35)' : 'rgba(192, 132, 252, 0.35)');
                    const roleBg = d.is_local ? 'rgba(56, 189, 248, 0.12)' : (d.is_gateway ? 'rgba(16, 185, 129, 0.12)' : 'rgba(192, 132, 252, 0.12)');

                    return `
                    <tr class="radar-device-row ${isSelected ? 'selected-radar-row' : ''}" onclick="window.networkRadarManager.selectDeviceByIp('${d.ip}')">
                        <!-- Column 1: Target Node & Device Identity -->
                        <td>
                            <div class="radar-dev-identity-cell">
                                <div class="radar-dev-avatar" style="border-color:${roleBorder}; background:${roleBg};">
                                    <span class="radar-dev-emoji">${d.emoji || '🖥️'}</span>
                                    <span class="radar-status-dot-mini online"></span>
                                </div>
                                <div class="radar-dev-info-col">
                                    <div class="radar-dev-name-row">
                                        <strong class="radar-dev-name">${escapeHtml(d.device_name || d.vendor)}</strong>
                                        ${d.is_local ? '<span class="badge-self-pill">YOU</span>' : ''}
                                    </div>
                                    <span class="radar-dev-sub">${escapeHtml(d.category || d.hostname || d.vendor)}</span>
                                </div>
                            </div>
                        </td>

                        <!-- Column 2: Network Address (IP) & Alloc -->
                        <td>
                            <div class="radar-ip-cell">
                                <span class="radar-ip-text mono-text">${escapeHtml(d.ip)}</span>
                                <span class="radar-alloc-badge">${escapeHtml(d.alloc_type || 'Dynamic (DHCP)')}</span>
                            </div>
                        </td>

                        <!-- Column 3: Hardware MAC & Vendor -->
                        <td>
                            <div class="radar-mac-cell">
                                <span class="radar-mac-text mono-text">${escapeHtml(d.mac)}</span>
                                <span class="radar-vendor-badge">${escapeHtml(d.vendor_brand || d.vendor)}</span>
                            </div>
                        </td>

                        <!-- Column 4: Latency & Link Quality -->
                        <td>
                            <div class="radar-latency-cell">
                                <div class="radar-ping-pill ${isUltra ? 'ping-ultra' : (isGood ? 'ping-good' : 'ping-moderate')}">
                                    <span class="ping-dot"></span>
                                    <strong>${pingVal} ms</strong>
                                </div>
                                <div class="radar-signal-meter" title="Connection Latency Score">
                                    <span class="sig-bar bar-1 on"></span>
                                    <span class="sig-bar bar-2 on"></span>
                                    <span class="sig-bar bar-3 ${isGood ? 'on' : ''}"></span>
                                    <span class="sig-bar bar-4 ${isUltra ? 'on' : ''}"></span>
                                </div>
                            </div>
                        </td>

                        <!-- Column 5: Network Role & Tier -->
                        <td>
                            <div class="radar-role-cell">
                                <span class="radar-role-pill" style="color:${roleColor}; border-color:${roleBorder}; background:${roleBg};">
                                    ${escapeHtml(d.is_local ? 'Host Machine' : (d.is_gateway ? 'Default Gateway' : 'Subnet Client'))}
                                </span>
                                <span class="radar-tier-tag mono-text">${escapeHtml(d.tier_label || 'Tier 2')}</span>
                            </div>
                        </td>

                        <!-- Column 6: Control Actions -->
                        <td style="text-align:right;" onclick="event.stopPropagation()">
                            <div class="radar-actions-group">
                                <button class="btn-radar-table-act ping-btn" title="Ping Test" onclick="window.networkRadarManager.pingTarget('${d.ip}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                    <span>Ping</span>
                                </button>
                                <button class="btn-radar-table-act copy-btn" title="Copy IP" onclick="navigator.clipboard.writeText('${d.ip}');showActionToast('📋 Đã copy IP: ${d.ip}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                                <button class="btn-radar-table-act target-btn" title="Lock Target on Radar" onclick="window.networkRadarManager.selectDeviceByIp('${d.ip}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                    `;
                }).join('');
            } else {
                let filtered = this.connections.filter(c => {
                    if (!q) return true;
                    return (c.process_name && c.process_name.toLowerCase().includes(q)) ||
                           (c.remote_addr && c.remote_addr.includes(q)) ||
                           (c.category && c.category.toLowerCase().includes(q));
                });

                if (this.dom.tableCountPill) {
                    this.dom.tableCountPill.textContent = `${filtered.length} Socket Flows`;
                }

                if (filtered.length === 0) {
                    this.dom.tbody.innerHTML = `<tr><td colspan="6" class="loading-state">Không có luồng kết nối socket nào phù hợp.</td></tr>`;
                    return;
                }

                this.dom.tbody.innerHTML = filtered.map(c => `
                    <tr class="radar-device-row" onclick="window.networkRadarManager.selectDeviceByIp('${c.remote_ip}')">
                        <td>
                            <div class="radar-dev-identity-cell">
                                <div class="radar-dev-avatar" style="border-color:rgba(192, 132, 252, 0.4); background:rgba(192, 132, 252, 0.12);">
                                    <span class="radar-dev-emoji">🌐</span>
                                    <span class="radar-status-dot-mini online"></span>
                                </div>
                                <div class="radar-dev-info-col">
                                    <div class="radar-dev-name-row">
                                        <strong class="radar-dev-name">${escapeHtml(c.process_name)}</strong>
                                        <span class="radar-tier-tag mono-text">PID: ${c.pid}</span>
                                    </div>
                                    <span class="radar-dev-sub">${escapeHtml(c.category || 'Outbound Socket')}</span>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="radar-ip-cell">
                                <span class="radar-ip-text mono-text" style="color:#38bdf8;">${escapeHtml(c.remote_addr)}</span>
                                <span class="radar-alloc-badge">Port ${c.remote_port}</span>
                            </div>
                        </td>
                        <td>
                            <div class="radar-mac-cell">
                                <span class="radar-mac-text mono-text">${escapeHtml(c.local_addr)}</span>
                                <span class="radar-vendor-badge">${escapeHtml(c.service || 'Remote Endpoint')}</span>
                            </div>
                        </td>
                        <td>
                            <div class="radar-latency-cell">
                                <div class="radar-ping-pill ping-ultra">
                                    <span class="ping-dot"></span>
                                    <strong>${escapeHtml(c.status)}</strong>
                                </div>
                            </div>
                        </td>
                        <td>
                            <div class="radar-role-cell">
                                <span class="radar-role-pill" style="color:#c084fc; border-color:rgba(192,132,252,0.3); background:rgba(192,132,252,0.12);">
                                    ${escapeHtml(c.category)}
                                </span>
                            </div>
                        </td>
                        <td style="text-align:right;" onclick="event.stopPropagation()">
                            <div class="radar-actions-group">
                                <button class="btn-radar-table-act ping-btn" title="Ping IP" onclick="window.networkRadarManager.pingTarget('${c.remote_ip}')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                                    <span>Ping</span>
                                </button>
                                <button class="btn-radar-table-act copy-btn" title="Copy IP" onclick="navigator.clipboard.writeText('${c.remote_ip}');showActionToast('📋 Đã copy IP')">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('');
            }
        }
    };

    // =========================================================================
    // TAB 9: POWER & CARBON COST ESTIMATOR MANAGER
    // =========================================================================
    const powerEstimatorManager = {
        chart: null,
        pollTimer: null,
        data: null,

        init() {
            this.cacheDOM();
            this.initChart();
            this.bindEvents();
            window.powerEstimatorManager = this;
        },

        cacheDOM() {
            this.dom = {
                btnRefresh: document.getElementById('btn-power-refresh'),
                btnToggleConfig: document.getElementById('btn-toggle-power-config'),
                configPanel: document.getElementById('power-config-panel'),
                configForm: document.getElementById('power-config-form'),
                gaugeBar: document.getElementById('power-gauge-bar'),
                liveWatts: document.getElementById('power-live-watts'),
                tierBadge: document.getElementById('power-tier-badge'),
                liveStatusDot: document.getElementById('power-live-status-dot'),
                cpuWatts: document.getElementById('power-cpu-watts'),
                baseWatts: document.getElementById('power-base-watts'),
                gpuWatts: document.getElementById('power-gpu-watts'),
                loadFill: document.getElementById('power-load-fill'),
                costMonth: document.getElementById('power-cost-month'),
                costHour: document.getElementById('power-cost-hour'),
                costDay: document.getElementById('power-cost-day'),
                costSession: document.getElementById('power-cost-session'),
                dailyHoursLabel: document.getElementById('power-daily-hours-label'),
                analogyCoffeeText: document.getElementById('power-analogy-coffee-text'),
                kwhSession: document.getElementById('power-kwh-session'),
                kwhHour: document.getElementById('power-kwh-hour'),
                kwhMonth: document.getElementById('power-kwh-month'),
                sessionTime: document.getElementById('power-session-time'),
                rateTag: document.getElementById('power-rate-tag'),
                rateHeaderTag: document.getElementById('power-rate-header-tag'),
                co2Month: document.getElementById('power-co2-month'),
                co2Day: document.getElementById('power-co2-day'),
                co2Session: document.getElementById('power-co2-session'),
                analogyTreesText: document.getElementById('power-analogy-trees-text'),
                chartPeak: document.getElementById('power-chart-peak'),
                chartAvg: document.getElementById('power-chart-avg'),
                chartMin: document.getElementById('power-chart-min'),
                cfgKwhPrice: document.getElementById('cfg-kwh-price'),
                cfgCpuTdp: document.getElementById('cfg-cpu-tdp'),
                cfgBaseWatts: document.getElementById('cfg-base-watts'),
                cfgGpuTdp: document.getElementById('cfg-gpu-tdp'),
                cfgDailyHours: document.getElementById('cfg-daily-hours'),
            };
        },

        initChart() {
            const ctx = document.getElementById('power-history-chart');
            if (!ctx) return;

            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
            const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
            const textColor = isDark ? '#94a3b8' : '#64748b';

            this.chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [
                        {
                            label: 'Total Power (W)',
                            data: [],
                            borderColor: '#bcf846',
                            backgroundColor: 'rgba(188, 248, 70, 0.12)',
                            borderWidth: 2.2,
                            fill: true,
                            tension: 0.35,
                            pointRadius: 0,
                            pointHoverRadius: 4,
                            pointHoverBackgroundColor: '#bcf846',
                        },
                        {
                            label: 'CPU Power (W)',
                            data: [],
                            borderColor: '#38bdf8',
                            borderWidth: 1.5,
                            borderDash: [4, 4],
                            fill: false,
                            tension: 0.35,
                            pointRadius: 0,
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    scales: {
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 8 }
                        },
                        y: {
                            min: 0,
                            grid: { color: gridColor },
                            ticks: { color: textColor, font: { family: 'JetBrains Mono', size: 10 } }
                        }
                    },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                color: textColor,
                                boxWidth: 12,
                                font: { size: 11, family: 'Inter' }
                            }
                        },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.92)',
                            titleColor: '#f8fafc',
                            bodyColor: '#e2e8f0',
                            borderColor: 'rgba(188, 248, 70, 0.3)',
                            borderWidth: 1,
                            padding: 10,
                            displayColors: true,
                        }
                    }
                }
            });
        },

        bindEvents() {
            if (this.dom.btnRefresh) {
                this.dom.btnRefresh.addEventListener('click', () => this.fetchStats());
            }

            if (this.dom.btnToggleConfig) {
                this.dom.btnToggleConfig.addEventListener('click', () => {
                    if (this.dom.configPanel) {
                        this.dom.configPanel.scrollIntoView({ behavior: 'smooth' });
                    }
                });
            }
        },

        onTabActivated() {
            this.fetchStats();
            if (!this.pollTimer) {
                this.pollTimer = setInterval(() => this.fetchStats(), 1000);
            }
            setTimeout(() => {
                if (this.chart) this.chart.resize();
            }, 60);
        },

        onTabDeactivated() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
        },

        async fetchStats() {
            try {
                const res = await fetch('/api/power/stats');
                if (!res.ok) return;
                const d = await res.json();
                this.data = d;
                this.renderUI(d);
            } catch (err) {
                console.error('Error fetching power stats:', err);
            }
        },

        renderUI(d) {
            if (!d) return;

            const inst = d.instant_power || {};
            const energy = d.energy_usage || {};
            const cost = d.cost_forecast || {};
            const carbon = d.carbon_footprint || {};
            const analogies = d.analogies || {};
            const cfg = d.config || {};

            // 1. Instant Radial Gauge & Breakdown
            const totalW = inst.total_watts || 0;
            if (this.dom.liveWatts) this.dom.liveWatts.textContent = totalW.toFixed(1);
            if (this.dom.cpuWatts) this.dom.cpuWatts.textContent = `${(inst.cpu_watts || 0).toFixed(1)} W`;
            if (this.dom.baseWatts) this.dom.baseWatts.textContent = `${(inst.base_watts || 0).toFixed(1)} W`;
            if (this.dom.gpuWatts) this.dom.gpuWatts.textContent = `${(inst.gpu_watts || 0).toFixed(1)} W`;

            // SVG Radial Gauge Calculation: Radius 50 => circumference = 2 * PI * 50 = 314.159
            const circumference = 314.16;
            const gaugePct = Math.min(100, Math.max(0, inst.gauge_percent || 0));
            const offset = circumference - (circumference * (gaugePct / 100));

            if (this.dom.gaugeBar) {
                this.dom.gaugeBar.style.strokeDashoffset = offset;
                this.dom.gaugeBar.style.stroke = inst.tier_color || '#bcf846';
            }

            if (this.dom.tierBadge) {
                this.dom.tierBadge.textContent = inst.tier_label || 'NORMAL';
                this.dom.tierBadge.className = `tier-pill ${inst.tier || 'normal'}`;
            }

            if (this.dom.loadFill) {
                this.dom.loadFill.style.width = `${Math.min(100, (totalW / 200) * 100)}%`;
            }

            // 2. Financial Forecast (VNĐ)
            if (this.dom.costMonth) this.dom.costMonth.textContent = (cost.vnd_per_month || 0).toLocaleString('vi-VN');
            if (this.dom.costHour) this.dom.costHour.textContent = `${(cost.vnd_per_hour || 0).toLocaleString('vi-VN')} đ / h`;
            if (this.dom.costDay) this.dom.costDay.textContent = `${(cost.vnd_per_day || 0).toLocaleString('vi-VN')} đ / ngày`;
            if (this.dom.costSession) this.dom.costSession.textContent = `${(cost.session_cost_vnd || 0).toLocaleString('vi-VN')} đ`;
            if (this.dom.dailyHoursLabel) this.dom.dailyHoursLabel.textContent = `${cost.daily_hours || 8}h`;
            if (this.dom.analogyCoffeeText) {
                this.dom.analogyCoffeeText.innerHTML = `Tương đương <strong>~${analogies.coffee_cups_month || 0} ly cà phê</strong> / tháng`;
            }

            // 3. Energy Consumption
            if (this.dom.kwhSession) this.dom.kwhSession.textContent = (energy.session_kwh || 0).toFixed(4);
            if (this.dom.kwhHour) this.dom.kwhHour.textContent = `${(energy.kwh_per_hour || 0).toFixed(4)} kWh / h`;
            if (this.dom.kwhMonth) this.dom.kwhMonth.textContent = `${(energy.kwh_per_month || 0).toFixed(2)} kWh / tháng`;
            if (this.dom.sessionTime) this.dom.sessionTime.textContent = `${(energy.session_hours || 0).toFixed(2)} giờ`;
            if (this.dom.rateTag) {
                this.dom.rateTag.innerHTML = `Đơn giá: <strong>${(cost.kwh_price_vnd || 2500).toLocaleString('vi-VN')} đ / kWh</strong>`;
            }
            if (this.dom.rateHeaderTag) {
                this.dom.rateHeaderTag.textContent = `💵 ${(cost.kwh_price_vnd || 2500).toLocaleString('vi-VN')} đ/kWh`;
            }

            // 4. Carbon Footprint
            if (this.dom.co2Month) this.dom.co2Month.textContent = (carbon.co2_kg_per_month || 0).toFixed(2);
            if (this.dom.co2Day) this.dom.co2Day.textContent = `${(carbon.co2_kg_per_day || 0).toFixed(3)} kg CO₂ / ngày`;
            if (this.dom.co2Session) this.dom.co2Session.textContent = `${(carbon.session_co2_kg || 0).toFixed(4)} kg CO₂`;
            if (this.dom.analogyTreesText) {
                this.dom.analogyTreesText.innerHTML = `Cần <strong>~${analogies.trees_needed_year || 0} cây xanh</strong> để bù đắp / năm`;
            }

            // 5. Populate Config Inputs if not focused
            if (this.dom.cfgKwhPrice && document.activeElement !== this.dom.cfgKwhPrice) this.dom.cfgKwhPrice.value = cfg.kwh_price_vnd || 2500;
            if (this.dom.cfgCpuTdp && document.activeElement !== this.dom.cfgCpuTdp) this.dom.cfgCpuTdp.value = cfg.cpu_tdp_watts || 65;
            if (this.dom.cfgBaseWatts && document.activeElement !== this.dom.cfgBaseWatts) this.dom.cfgBaseWatts.value = cfg.base_idle_watts || 35;
            if (this.dom.cfgGpuTdp && document.activeElement !== this.dom.cfgGpuTdp) this.dom.cfgGpuTdp.value = cfg.gpu_tdp_watts || 75;
            if (this.dom.cfgDailyHours && document.activeElement !== this.dom.cfgDailyHours) this.dom.cfgDailyHours.value = cfg.daily_hours || 8;

            // 6. Update Real-time Chart
            const history = d.history || [];
            if (this.chart && history.length > 0) {
                this.chart.data.labels = history.map(h => h.time);
                this.chart.data.datasets[0].data = history.map(h => h.watts);
                this.chart.data.datasets[1].data = history.map(h => h.cpu_watts);
                this.chart.update('none');

                const wattsArr = history.map(h => h.watts);
                const peak = Math.max(...wattsArr);
                const min = Math.min(...wattsArr);
                const avg = wattsArr.reduce((a, b) => a + b, 0) / wattsArr.length;

                if (this.dom.chartPeak) this.dom.chartPeak.textContent = `${peak.toFixed(1)} W`;
                if (this.dom.chartMin) this.dom.chartMin.textContent = `${min.toFixed(1)} W`;
                if (this.dom.chartAvg) this.dom.chartAvg.textContent = `${avg.toFixed(1)} W`;
            }
        },

        async saveConfig() {
            const payload = {
                kwh_price_vnd: parseFloat(this.dom.cfgKwhPrice.value) || 2500,
                cpu_tdp_watts: parseFloat(this.dom.cfgCpuTdp.value) || 65,
                base_idle_watts: parseFloat(this.dom.cfgBaseWatts.value) || 35,
                gpu_tdp_watts: parseFloat(this.dom.cfgGpuTdp.value) || 0,
                daily_hours: parseFloat(this.dom.cfgDailyHours.value) || 8,
            };

            try {
                const res = await fetch('/api/power/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (d.status === 'success') {
                    showActionToast('💾 Đã lưu cấu hình đơn giá điện & công suất TDP');
                    this.fetchStats();
                }
            } catch (err) {
                showActionToast('⚠️ Lỗi lưu cấu hình: ' + err.message, true);
            }
        },

        resetConfigDefault() {
            if (this.dom.cfgKwhPrice) this.dom.cfgKwhPrice.value = 2500;
            if (this.dom.cfgCpuTdp) this.dom.cfgCpuTdp.value = 65;
            if (this.dom.cfgBaseWatts) this.dom.cfgBaseWatts.value = 35;
            if (this.dom.cfgGpuTdp) this.dom.cfgGpuTdp.value = 75;
            if (this.dom.cfgDailyHours) this.dom.cfgDailyHours.value = 8;
            this.saveConfig();
        }
    };

    // =========================================================================
    // CYBER TAMAGOTCHI / VIRTUAL DESKTOP PET CONTROLLER
    // =========================================================================
    const cyberPetManager = {
        storageKey: 'cyber_tamagotchi_data',
        state: {
            name: 'BYTE-KUN',
            happiness: 100,
            level: 1,
            xp: 0,
            soundEnabled: true,
            isMinimized: false,
            isFloating: false,
            currentMood: 'chill', // 'chill', 'productive', 'stressed', 'hungry'
            isReacting: false,
        },
        dialogueTimer: null,
        audioCtx: null,

        dialogues: {
            chill: [
                "Máy mát rượi, ngủ tí đã... (～﹃～)~zZ",
                "Chủ nhân đang chill à? CPU êm ru!",
                "Hệ thống ổn định tuyệt đối! Không giật lag.",
                "Zzz... đừng làm ồn để bé ngủ nhen...",
                "Thời tiết mát mẻ, dàn máy mát như điều hòa!",
            ],
            productive: [
                "Đang cày cuốc chăm chỉ đấy! Cố lên sếp!",
                "Code bay như gió, năng suất x100!",
                "Hệ thống đang chạy hết công suất phục vụ bạn!",
                "Nhớ chớp mắt và uống ngụm nước nhé sếp iu!",
                "Bàn phím gõ tanh tách nghe đã tai ghê!",
            ],
            stressed: [
                "Nóng quá sếp ơi! CPU đang bốc khói rồi!",
                "Ai vừa mở 50 tab Chrome vậy?! Cho em xin tí RAM!",
                "Cứu bé với, quạt tản nhiệt đang bay như trực thăng!",
                "Hạ nhiệt giúp em với, toát hết mồ hôi hột rồi!",
                "Stress quá sếp ơi, bấm Ăn RAM giúp em đi!",
            ],
            hungry: [
                "Ổ C: nghẹn rồi, dọn rác giúp tôi đi!",
                "Bụng căng cứng vì file rác rồi sếp ơi!",
                "Dung lượng sắp cạn, bấm nút Dọn rác cứu bé với!",
                "Cần giải phóng dung lượng khẩn cấp!",
            ],
            happy: [
                "Mlem mlem! Cảm ơn sếp iu đã chăm sóc! (+10 💖)",
                "Ngon tuyệt! Bé tràn đầy năng lượng rồi! ✨",
                "Hehe, được vuốt ve thích quá à! (✿◠‿◠)",
                "Sếp là số 1! Yêu thương sếp nhiều! 💖",
            ]
        },

        init() {
            this.loadState();
            this.cacheDOM();
            this.bindEvents();
            this.applyStateToUI();
            this.startTimers();
            window.cyberPetManager = this;
        },

        loadState() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    this.state = { ...this.state, ...parsed };
                }
            } catch (e) {
                console.warn('Error loading pet data:', e);
            }
        },

        saveState() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.state));
            } catch (e) {
                console.error('Error saving pet data:', e);
            }
        },

        cacheDOM() {
            this.dom = {
                widget: document.getElementById('sidebar-cyber-pet-widget'),
                content: document.getElementById('pet-widget-content'),
                displayName: document.getElementById('pet-display-name'),
                levelBadge: document.getElementById('pet-level-badge'),
                btnFloat: document.getElementById('btn-pet-float-toggle'),
                btnSound: document.getElementById('btn-pet-sound-toggle'),
                btnMinimize: document.getElementById('btn-pet-minimize'),
                headerPetLauncher: document.getElementById('btn-header-pet-launcher'),
                headerPetMoodPill: document.getElementById('header-pet-mood-pill'),
                speechBubble: document.getElementById('pet-speech-bubble'),
                speechText: document.getElementById('pet-speech-text'),
                stage: document.getElementById('pet-interactive-stage'),
                avatar: document.getElementById('pet-avatar-wrapper'),
                particlesLayer: document.getElementById('pet-particles-layer'),
                moodBadge: document.getElementById('pet-mood-badge'),
                moodText: document.getElementById('pet-mood-text'),
                happinessText: document.getElementById('pet-happiness-text'),
                happinessBar: document.getElementById('pet-happiness-bar'),
                sysLoadText: document.getElementById('pet-sys-load-text'),
                loadBar: document.getElementById('pet-load-bar'),
                btnFeed: document.getElementById('btn-pet-feed-ram'),
                btnPoke: document.getElementById('btn-pet-poke'),
                btnClean: document.getElementById('btn-pet-clean-temp'),
                sprites: {
                    chill: document.getElementById('pet-sprite-chill'),
                    productive: document.getElementById('pet-sprite-productive'),
                    stressed: document.getElementById('pet-sprite-stressed'),
                    hungry: document.getElementById('pet-sprite-hungry'),
                }
            };
        },

        bindEvents() {
            if (this.dom.stage) {
                this.dom.stage.addEventListener('click', (e) => this.pokePet(e));
            }

            if (this.dom.btnPoke) {
                this.dom.btnPoke.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.pokePet(e);
                });
            }

            if (this.dom.btnFeed) {
                this.dom.btnFeed.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.feedRam();
                });
            }

            if (this.dom.btnClean) {
                this.dom.btnClean.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.cleanDisk();
                });
            }

            if (this.dom.btnFloat) {
                this.dom.btnFloat.addEventListener('click', () => this.toggleFloat());
            }

            if (this.dom.btnSound) {
                this.dom.btnSound.addEventListener('click', () => this.toggleSound());
            }

            if (this.dom.btnMinimize) {
                this.dom.btnMinimize.addEventListener('click', () => this.toggleMinimize());
            }

            if (this.dom.headerPetLauncher) {
                this.dom.headerPetLauncher.addEventListener('click', () => this.focusOrTogglePet());
            }

            if (this.dom.displayName) {
                this.dom.displayName.addEventListener('dblclick', () => this.renamePet());
            }
        },

        startTimers() {
            // Periodic dialogue rotation
            this.dialogueTimer = setInterval(() => {
                if (!this.state.isReacting) {
                    this.updateDialogue();
                }
            }, 9000);
        },

        onMetricsUpdate(data) {
            if (!data) return;

            const cpu = data.cpu ? data.cpu.overall_percent : 0;
            const ram = (data.memory && data.memory.ram) ? data.memory.ram.percent : 0;
            const partitions = (data.disk && data.disk.partitions) ? data.disk.partitions : [];

            // Check if drive C: is nearly full (< 5GB free)
            let isDiskFull = false;
            for (const p of partitions) {
                if (p.mountpoint && (p.mountpoint.startsWith('C') || (p.device && p.device.startsWith('C')))) {
                    const freeGb = (p.free || 0) / (1024 ** 3);
                    if (freeGb < 5) isDiskFull = true;
                    break;
                }
            }

            // Determine Mood
            let newMood = 'chill';
            if (isDiskFull) {
                newMood = 'hungry';
            } else if (cpu > 80 || ram > 85) {
                newMood = 'stressed';
            } else if (cpu >= 30 || (data.network && (data.network.bytes_recv_rate > 200000 || data.network.bytes_sent_rate > 100000))) {
                newMood = 'productive';
            } else {
                newMood = 'chill';
            }

            // System Load composite
            const sysLoad = Math.round((cpu * 0.6) + (ram * 0.4));
            if (this.dom.sysLoadText) this.dom.sysLoadText.textContent = `${sysLoad}%`;
            if (this.dom.loadBar) this.dom.loadBar.style.width = `${Math.min(100, Math.max(0, sysLoad))}%`;

            // Adjust happiness gradually
            if (newMood === 'stressed') {
                this.state.happiness = Math.max(10, this.state.happiness - 0.2);
            } else if (newMood === 'chill') {
                this.state.happiness = Math.min(100, this.state.happiness + 0.1);
            }
            this.renderHappiness();

            // If mood changed
            if (this.state.currentMood !== newMood) {
                this.state.currentMood = newMood;
                this.setSprite(newMood);
                this.updateMoodBadge(newMood);
                if (!this.state.isReacting) {
                    this.updateDialogue();
                }
                if (newMood === 'stressed') {
                    this.playSound('buzzer');
                }
            }
        },

        setSprite(mood) {
            if (!this.dom.sprites) return;
            Object.keys(this.dom.sprites).forEach(k => {
                if (this.dom.sprites[k]) {
                    this.dom.sprites[k].classList.toggle('hidden', k !== mood);
                }
            });

            if (this.dom.avatar) {
                this.dom.avatar.className = `pet-avatar ${mood}`;
            }
        },

        updateMoodBadge(mood) {
            if (!this.dom.moodBadge || !this.dom.moodText) return;
            const labels = {
                chill: 'THẢNH THƠI (CHILL)',
                productive: 'CHĂM CHỈ (WORKING)',
                stressed: 'QUÁ TẢI (STRESSED)',
                hungry: 'BỘI THỰC (FULL DISK)',
            };
            this.dom.moodText.textContent = labels[mood] || 'NORMAL';
            this.dom.moodBadge.className = `pet-mood-pill ${mood}`;
        },

        updateDialogue(customText = null) {
            if (!this.dom.speechText) return;
            let text = customText;
            if (!text) {
                const list = this.dialogues[this.state.currentMood] || this.dialogues.chill;
                text = list[Math.floor(Math.random() * list.length)];
            }
            this.dom.speechText.textContent = text;
        },

        renderHappiness() {
            const h = Math.round(this.state.happiness);
            if (this.dom.happinessText) this.dom.happinessText.textContent = `${h}%`;
            if (this.dom.happinessBar) this.dom.happinessBar.style.width = `${h}%`;
            if (this.dom.headerPetMoodPill) this.dom.headerPetMoodPill.textContent = `💖 ${h}%`;
        },

        pokePet(e) {
            this.state.happiness = Math.min(100, this.state.happiness + 5);
            this.addXP(5);
            this.renderHappiness();
            this.playSound('poke');

            // Trigger Jump animation
            if (this.dom.avatar) {
                this.dom.avatar.classList.remove('bounce');
                void this.dom.avatar.offsetWidth; // trigger reflow
                this.dom.avatar.classList.add('bounce');
            }

            // Spawn Particles
            this.spawnParticle('💖', e ? e.clientX : null, e ? e.clientY : null);
            this.spawnParticle('+5 XP', null, null, '#fbbf24');

            // Happy Reaction Dialogue
            this.state.isReacting = true;
            const happyList = this.dialogues.happy;
            const msg = happyList[Math.floor(Math.random() * happyList.length)];
            this.updateDialogue(msg);

            setTimeout(() => {
                this.state.isReacting = false;
            }, 4000);
            this.saveState();
        },

        async feedRam() {
            this.state.happiness = Math.min(100, this.state.happiness + 15);
            this.addXP(15);
            this.renderHappiness();
            this.playSound('nom');

            this.spawnParticle('🍖 RAM', null, null, '#bcf846');
            this.spawnParticle('+15 💖', null, null, '#ec4899');

            this.state.isReacting = true;
            this.updateDialogue('Mlem mlem! Đã được ăn RAM sạch sẽ, cảm ơn sếp iu! (✿◠‿◠)');

            try {
                await fetch('/api/focus/engage', { method: 'POST' });
                showActionToast('🍖 Thú cưng đã dọn dẹp và nạp RAM sạch sẽ (+15 💖)!');
            } catch (err) {
                console.warn(err);
            }

            setTimeout(() => {
                this.state.isReacting = false;
                this.updateDialogue();
            }, 4500);
            this.saveState();
        },

        async cleanDisk() {
            this.state.happiness = Math.min(100, this.state.happiness + 10);
            this.addXP(10);
            this.renderHappiness();
            this.playSound('happy');

            this.spawnParticle('🧹 CLEAN!', null, null, '#38bdf8');
            this.spawnParticle('+10 💖', null, null, '#ec4899');

            this.state.isReacting = true;
            this.updateDialogue('Đã quét sạch rác hệ thống! Bụng bé nhẹ nhõm hẳn rồi nè! ✨');

            try {
                await fetch('/api/actions/clean-temp', { method: 'POST' });
                showActionToast('🧹 Thú cưng đã dọn dẹp sạch thư mục Temp!');
            } catch (err) {
                console.warn(err);
            }

            setTimeout(() => {
                this.state.isReacting = false;
                this.updateDialogue();
            }, 4500);
            this.saveState();
        },

        addXP(amount) {
            this.state.xp += amount;
            const nextLvlXp = this.state.level * 50;
            if (this.state.xp >= nextLvlXp) {
                this.state.level += 1;
                this.state.xp = 0;
                this.playSound('happy');
                showActionToast(`🎉 BYTE-KUN đã thăng cấp lên LEVEL ${this.state.level}! ✨`);
                if (this.dom.levelBadge) this.dom.levelBadge.textContent = `LV.${this.state.level}`;
                this.spawnParticle('LEVEL UP! ⭐', null, null, '#fbbf24');
            }
        },

        spawnParticle(text, clientX = null, clientY = null, color = '#ec4899') {
            if (!this.dom.particlesLayer) return;
            const p = document.createElement('div');
            p.className = 'floating-pet-particle';
            p.textContent = text;
            p.style.color = color;
            p.style.left = `${30 + Math.random() * 40}%`;
            p.style.top = `${20 + Math.random() * 30}%`;
            this.dom.particlesLayer.appendChild(p);

            setTimeout(() => {
                p.remove();
            }, 1000);
        },

        renamePet() {
            const current = this.state.name || 'BYTE-KUN';
            const newName = prompt('Nhập tên mới cho thú cưng ảo:', current);
            if (newName && newName.trim()) {
                this.state.name = newName.trim().toUpperCase();
                if (this.dom.displayName) this.dom.displayName.textContent = this.state.name;
                this.saveState();
                showActionToast(`🏷️ Đã đổi tên thú cưng thành "${this.state.name}"`);
            }
        },

        toggleSound() {
            this.state.soundEnabled = !this.state.soundEnabled;
            if (this.dom.btnSound) {
                this.dom.btnSound.textContent = this.state.soundEnabled ? '🔊' : '🔇';
            }
            this.saveState();
            showActionToast(this.state.soundEnabled ? '🔊 Đã bật âm thanh Thú cưng' : '🔇 Đã tắt âm thanh Thú cưng');
        },

        toggleMinimize() {
            this.state.isMinimized = !this.state.isMinimized;
            if (this.dom.content) {
                this.dom.content.classList.toggle('hidden', this.state.isMinimized);
            }
            if (this.dom.btnMinimize) {
                this.dom.btnMinimize.textContent = this.state.isMinimized ? '▸' : '▾';
            }
            this.saveState();
        },

        toggleFloat() {
            this.state.isFloating = !this.state.isFloating;
            if (this.dom.widget) {
                this.dom.widget.classList.toggle('floating-mode', this.state.isFloating);
            }
            if (this.dom.btnFloat) {
                this.dom.btnFloat.textContent = this.state.isFloating ? '📌' : '🚀';
                this.dom.btnFloat.title = this.state.isFloating ? 'Gắn lại vào thanh Sidebar (Dock)' : 'Chế độ Bay lơ lửng trên màn hình (Float)';
            }
            this.saveState();
            showActionToast(this.state.isFloating ? '🚀 Thú cưng đang bay lơ lửng trên màn hình!' : '📌 Đã gắn Thú cưng trở lại Sidebar');
        },

        focusOrTogglePet() {
            if (this.state.isMinimized) {
                this.toggleMinimize();
            }
            if (this.dom.widget) {
                this.dom.widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            this.pokePet();
        },

        applyStateToUI() {
            if (this.dom.displayName) this.dom.displayName.textContent = this.state.name || 'BYTE-KUN';
            if (this.dom.levelBadge) this.dom.levelBadge.textContent = `LV.${this.state.level || 1}`;
            if (this.dom.btnSound) this.dom.btnSound.textContent = this.state.soundEnabled ? '🔊' : '🔇';
            if (this.dom.content) this.dom.content.classList.toggle('hidden', !!this.state.isMinimized);
            if (this.dom.btnMinimize) this.dom.btnMinimize.textContent = this.state.isMinimized ? '▸' : '▾';
            if (this.dom.widget) this.dom.widget.classList.toggle('floating-mode', !!this.state.isFloating);
            if (this.dom.btnFloat) {
                this.dom.btnFloat.textContent = this.state.isFloating ? '📌' : '🚀';
                this.dom.btnFloat.title = this.state.isFloating ? 'Gắn lại vào thanh Sidebar (Dock)' : 'Chế độ Bay lơ lửng trên màn hình (Float)';
            }
            this.renderHappiness();
            this.setSprite(this.state.currentMood || 'chill');
            this.updateMoodBadge(this.state.currentMood || 'chill');
        },

        playSound(type) {
            if (!this.state.soundEnabled) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                if (!this.audioCtx) this.audioCtx = new AudioCtx();
                if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

                const now = this.audioCtx.currentTime;
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();

                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                if (type === 'poke') {
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(587.33, now); // D5
                    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5
                    gain.gain.setValueAtTime(0.08, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                    osc.start(now);
                    osc.stop(now + 0.15);
                } else if (type === 'nom') {
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(440, now);
                    osc.frequency.setValueAtTime(330, now + 0.08);
                    osc.frequency.setValueAtTime(550, now + 0.16);
                    gain.gain.setValueAtTime(0.09, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                    osc.start(now);
                    osc.stop(now + 0.25);
                } else if (type === 'happy') {
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(523.25, now); // C5
                    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
                    osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
                    osc.frequency.setValueAtTime(1046.50, now + 0.24); // C6
                    gain.gain.setValueAtTime(0.05, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                    osc.start(now);
                    osc.stop(now + 0.35);
                } else if (type === 'buzzer') {
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(180, now);
                    osc.frequency.setValueAtTime(140, now + 0.1);
                    gain.gain.setValueAtTime(0.06, now);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                    osc.start(now);
                    osc.stop(now + 0.2);
                }
            } catch (err) {
                // Audio Context autoplay blocked
            }
        }
    };

    // =========================================================================
    // TAB 10: DYNAMIC WALLPAPER STUDIO & ONE-CLICK DESKTOP SET
    // =========================================================================
    const wallpaperManager = {
        state: {
            category: 'all',
            query: '',
            resolution: '4k',
            sorting: 'toplist',
            currentPage: 1,
            totalPages: 1,
            totalWallpapers: 0,
            wallpapers: [],
            activeWallpaper: null,
            isLoading: false,
            lastAppliedTitle: null,
        },
        dom: {},
        debounceTimer: null,

        init() {
            this.cacheDOM();
            this.bindEvents();
            window.wallpaperManager = this;
        },

        cacheDOM() {
            this.dom = {
                view: document.getElementById('view-wallpaper-studio'),
                categoryPills: document.getElementById('wallpaper-category-pills'),
                searchInput: document.getElementById('wallpaper-search-input'),
                btnClearSearch: document.getElementById('btn-wallpaper-search-clear'),
                resSelect: document.getElementById('wallpaper-resolution-filter'),
                sortSelect: document.getElementById('wallpaper-sorting-filter'),
                btnRandomize: document.getElementById('btn-wallpaper-randomize'),
                btnRefresh: document.getElementById('btn-wallpaper-refresh'),
                grid: document.getElementById('wallpaper-grid'),
                skeletonGrid: document.getElementById('wallpaper-skeleton-grid'),
                countText: document.getElementById('wallpaper-gallery-count-text'),
                sourceBadge: document.getElementById('wallpaper-source-badge'),
                lastAppliedBanner: document.getElementById('wallpaper-last-applied-banner'),
                lastAppliedTitle: document.getElementById('last-applied-title'),
                btnPrevPage: document.getElementById('btn-wallpaper-prev-page'),
                btnNextPage: document.getElementById('btn-wallpaper-next-page'),
                pageIndicator: document.getElementById('wallpaper-page-indicator'),
                
                // Lightbox Modal
                lightboxModal: document.getElementById('wallpaper-lightbox-modal'),
                btnCloseLightbox: document.getElementById('btn-close-wallpaper-lightbox'),
                lightboxImage: document.getElementById('lightbox-full-image'),
                lightboxLoader: document.getElementById('lightbox-image-loader'),
                lightboxTitle: document.getElementById('lightbox-title'),
                lightboxResChip: document.getElementById('lightbox-res-chip'),
                lightboxCategoryChip: document.getElementById('lightbox-category-chip'),
                lightboxViewsChip: document.getElementById('lightbox-views-chip'),
                btnLightboxDownload: document.getElementById('btn-lightbox-download'),
                btnLightboxSetDesktop: document.getElementById('btn-lightbox-set-desktop'),
                lightboxSetBtnText: document.getElementById('lightbox-set-btn-text'),
            };
        },

        bindEvents() {
            // Category Pills click
            if (this.dom.categoryPills) {
                this.dom.categoryPills.addEventListener('click', (e) => {
                    const btn = e.target.closest('.cat-pill');
                    if (!btn) return;
                    const cat = btn.getAttribute('data-category');
                    if (cat === this.state.category) return;
                    this.dom.categoryPills.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.state.category = cat;
                    this.state.currentPage = 1;
                    this.fetchWallpapers(1);
                });
            }

            // Search input with debounce
            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', (e) => {
                    const val = e.target.value;
                    if (this.dom.btnClearSearch) {
                        this.dom.btnClearSearch.classList.toggle('hidden', !val);
                    }
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        this.state.query = val.trim();
                        this.state.currentPage = 1;
                        this.fetchWallpapers(1);
                    }, 400);
                });
            }

            if (this.dom.btnClearSearch) {
                this.dom.btnClearSearch.addEventListener('click', () => {
                    if (this.dom.searchInput) {
                        this.dom.searchInput.value = '';
                        this.dom.btnClearSearch.classList.add('hidden');
                        this.state.query = '';
                        this.state.currentPage = 1;
                        this.fetchWallpapers(1);
                    }
                });
            }

            // Resolution select
            if (this.dom.resSelect) {
                this.dom.resSelect.addEventListener('change', (e) => {
                    this.state.resolution = e.target.value;
                    this.state.currentPage = 1;
                    this.fetchWallpapers(1);
                });
            }

            // Sorting select
            if (this.dom.sortSelect) {
                this.dom.sortSelect.addEventListener('change', (e) => {
                    this.state.sorting = e.target.value;
                    this.state.currentPage = 1;
                    this.fetchWallpapers(1);
                });
            }

            // Randomize button
            if (this.dom.btnRandomize) {
                this.dom.btnRandomize.addEventListener('click', () => {
                    this.state.sorting = 'random';
                    if (this.dom.sortSelect) this.dom.sortSelect.value = 'random';
                    this.state.currentPage = 1;
                    this.fetchWallpapers(1);
                    showActionToast('🎲 Đang tìm kiếm bộ sưu tập hình nền ngẫu nhiên...');
                });
            }

            // Refresh button
            if (this.dom.btnRefresh) {
                this.dom.btnRefresh.addEventListener('click', () => {
                    this.fetchWallpapers(this.state.currentPage);
                    showActionToast('🔄 Đang làm mới danh sách hình nền...');
                });
            }

            // Pagination buttons
            if (this.dom.btnPrevPage) {
                this.dom.btnPrevPage.addEventListener('click', () => {
                    if (this.state.currentPage > 1) {
                        this.fetchWallpapers(this.state.currentPage - 1);
                    }
                });
            }

            if (this.dom.btnNextPage) {
                this.dom.btnNextPage.addEventListener('click', () => {
                    if (this.state.currentPage < this.state.totalPages) {
                        this.fetchWallpapers(this.state.currentPage + 1);
                    }
                });
            }

            // Lightbox close
            if (this.dom.btnCloseLightbox) {
                this.dom.btnCloseLightbox.addEventListener('click', () => this.closeLightbox());
            }

            if (this.dom.lightboxModal) {
                this.dom.lightboxModal.addEventListener('click', (e) => {
                    if (e.target === this.dom.lightboxModal) this.closeLightbox();
                });
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.dom.lightboxModal && !this.dom.lightboxModal.classList.contains('hidden')) {
                    this.closeLightbox();
                }
            });

            // Set desktop from lightbox
            if (this.dom.btnLightboxSetDesktop) {
                this.dom.btnLightboxSetDesktop.addEventListener('click', () => {
                    if (this.state.activeWallpaper) {
                        this.setDesktopWallpaper(this.state.activeWallpaper.full_url, this.state.activeWallpaper.title, this.dom.btnLightboxSetDesktop);
                    }
                });
            }
        },

        onTabActivated() {
            if (this.state.wallpapers.length === 0) {
                this.fetchWallpapers(1);
            }
        },

        async fetchWallpapers(page = 1) {
            this.state.isLoading = true;
            this.state.currentPage = page;
            this.showSkeletons(true);

            const params = new URLSearchParams({
                category: this.state.category,
                sorting: this.state.sorting,
                resolution: this.state.resolution,
                page: page
            });
            if (this.state.query) {
                params.append('q', this.state.query);
            }

            try {
                const res = await fetch(`/api/wallpapers?${params.toString()}`);
                if (res.ok) {
                    const data = await res.json();
                    this.state.wallpapers = data.wallpapers || [];
                    this.state.currentPage = data.current_page || page;
                    this.state.totalPages = data.last_page || 1;
                    this.state.totalWallpapers = data.total || this.state.wallpapers.length;
                    
                    if (this.dom.sourceBadge) {
                        this.dom.sourceBadge.textContent = data.source === 'wallhaven' ? 'Nguồn: Wallhaven API (Online)' : 'Nguồn: Curated 4K CDN Gallery';
                    }
                    this.renderGrid();
                    this.updatePagination();
                } else {
                    showActionToast('⚠️ Không thể tải danh sách hình nền');
                }
            } catch (e) {
                console.error('Error fetching wallpapers:', e);
                showActionToast('⚠️ Lỗi kết nối khi lấy hình nền');
            } finally {
                this.state.isLoading = false;
                this.showSkeletons(false);
            }
        },

        showSkeletons(show) {
            if (this.dom.skeletonGrid) this.dom.skeletonGrid.classList.toggle('hidden', !show);
            if (this.dom.grid && show) this.dom.grid.innerHTML = '';
        },

        renderGrid() {
            if (!this.dom.grid) return;
            if (this.state.wallpapers.length === 0) {
                this.dom.grid.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; color: var(--text-muted);">
                        <span style="font-size: 2.5rem; display: block; margin-bottom: 12px;">🔍</span>
                        <h4 style="color: var(--text-primary); margin: 0 0 6px 0;">Không tìm thấy hình nền phù hợp</h4>
                        <p style="font-size: 0.85rem; margin: 0;">Thử chọn thể loại khác hoặc từ khóa tìm kiếm chung hơn.</p>
                    </div>
                `;
                return;
            }

            if (this.dom.countText) {
                this.dom.countText.textContent = `Hiển thị ${this.state.wallpapers.length} hình nền chất lượng cao (${this.state.totalWallpapers} tổng cộng)`;
            }

            const html = this.state.wallpapers.map((wp, idx) => {
                const resLabel = wp.resolution.includes('3840') ? '4K UHD' : (wp.resolution.includes('2560') ? '2K QHD' : 'Full HD');
                const viewsStr = wp.views ? (wp.views >= 1000 ? `${(wp.views/1000).toFixed(1)}k` : wp.views) : 'HD';
                const favsStr = wp.favorites ? (wp.favorites >= 1000 ? `${(wp.favorites/1000).toFixed(1)}k` : wp.favorites) : '';

                return `
                    <div class="wallpaper-card" data-index="${idx}">
                        <div class="wallpaper-thumb-wrapper">
                            <img class="wallpaper-thumb" src="${escapeHtml(wp.thumb_url)}" alt="${escapeHtml(wp.title)}" loading="lazy" />
                            
                            <div class="wallpaper-card-badges">
                                <span class="badge-res">${resLabel}</span>
                                <span class="badge-cat">${escapeHtml(wp.category)}</span>
                            </div>

                            <div class="wallpaper-hover-overlay">
                                <div class="overlay-btn-group">
                                    <button class="btn-card-set-desktop" data-url="${escapeHtml(wp.full_url)}" data-title="${escapeHtml(wp.title)}" title="Đặt làm hình nền Windows ngay">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3">
                                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                                            <line x1="8" y1="21" x2="16" y2="21"></line>
                                            <line x1="12" y1="17" x2="12" y2="21"></line>
                                        </svg>
                                        <span>Đặt Hình Nền</span>
                                    </button>
                                    <button class="btn-card-preview" data-index="${idx}" title="Xem trước toàn màn hình">
                                        <span>👁️ Xem 4K</span>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="wallpaper-card-info">
                            <span class="wallpaper-card-title" title="${escapeHtml(wp.title)}">${escapeHtml(wp.title)}</span>
                            <div class="wallpaper-card-stats">
                                <span>👁️ ${viewsStr}</span>
                                ${favsStr ? `<span>💖 ${favsStr}</span>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            this.dom.grid.innerHTML = html;

            // Bind Card Button events
            this.dom.grid.querySelectorAll('.btn-card-set-desktop').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const url = btn.getAttribute('data-url');
                    const title = btn.getAttribute('data-title');
                    this.setDesktopWallpaper(url, title, btn);
                });
            });

            this.dom.grid.querySelectorAll('.btn-card-preview').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const idx = parseInt(btn.getAttribute('data-index'), 10);
                    if (this.state.wallpapers[idx]) {
                        this.openLightbox(this.state.wallpapers[idx]);
                    }
                });
            });
        },

        updatePagination() {
            if (this.dom.btnPrevPage) {
                this.dom.btnPrevPage.disabled = this.state.currentPage <= 1;
            }
            if (this.dom.btnNextPage) {
                this.dom.btnNextPage.disabled = this.state.currentPage >= this.state.totalPages;
            }
            if (this.dom.pageIndicator) {
                this.dom.pageIndicator.textContent = `Trang ${this.state.currentPage} / ${this.state.totalPages}`;
            }
        },

        async setDesktopWallpaper(imageUrl, title, btnElement) {
            if (!imageUrl) return;

            let originalContent = '';
            if (btnElement) {
                originalContent = btnElement.innerHTML;
                btnElement.innerHTML = `<span>⏳ Đang đổi...</span>`;
                btnElement.disabled = true;
            }

            showActionToast(`⏳ Đang tải ảnh chất lượng gốc và đổi hình nền máy tính...`);

            try {
                const res = await fetch('/api/wallpapers/set-desktop', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_url: imageUrl, title: title })
                });

                if (res.ok) {
                    const data = await res.json();
                    showActionToast(`🎉 ĐÃ ĐỔI HÌNH NỀN MÁY TÍNH WINDOWS THÀNH CÔNG! ✨`);
                    this.state.lastAppliedTitle = title || 'Custom Wallpaper';
                    if (this.dom.lastAppliedBanner && this.dom.lastAppliedTitle) {
                        this.dom.lastAppliedTitle.textContent = this.state.lastAppliedTitle;
                        this.dom.lastAppliedBanner.style.display = 'inline-flex';
                    }
                } else {
                    const err = await res.json();
                    showActionToast(`⚠️ Lỗi đổi hình nền: ${err.detail || 'Không thành công'}`);
                }
            } catch (e) {
                console.error('Error setting desktop wallpaper:', e);
                showActionToast('⚠️ Lỗi kết nối khi gửi lệnh đổi hình nền');
            } finally {
                if (btnElement) {
                    btnElement.innerHTML = originalContent;
                    btnElement.disabled = false;
                }
            }
        },

        openLightbox(wp) {
            this.state.activeWallpaper = wp;
            if (!this.dom.lightboxModal) return;

            if (this.dom.lightboxTitle) this.dom.lightboxTitle.textContent = wp.title || '4K Wallpaper';
            if (this.dom.lightboxResChip) this.dom.lightboxResChip.textContent = `📐 ${wp.resolution || '3840x2160'} (${wp.ratio || '16:9'})`;
            if (this.dom.lightboxCategoryChip) this.dom.lightboxCategoryChip.textContent = `🏷️ ${wp.category || 'General'}`;
            if (this.dom.lightboxViewsChip) this.dom.lightboxViewsChip.textContent = `👁️ ${wp.views ? wp.views.toLocaleString() : 'HD'} lượt xem`;
            if (this.dom.btnLightboxDownload) {
                this.dom.btnLightboxDownload.href = wp.full_url;
            }

            if (this.dom.lightboxImage && this.dom.lightboxLoader) {
                this.dom.lightboxLoader.classList.remove('hidden');
                this.dom.lightboxImage.style.opacity = '0';
                this.dom.lightboxImage.src = wp.full_url;
                this.dom.lightboxImage.onload = () => {
                    if (this.dom.lightboxLoader) this.dom.lightboxLoader.classList.add('hidden');
                    if (this.dom.lightboxImage) this.dom.lightboxImage.style.opacity = '1';
                };
            }

            this.dom.lightboxModal.classList.remove('hidden');
        },

        closeLightbox() {
            if (this.dom.lightboxModal) {
                this.dom.lightboxModal.classList.add('hidden');
            }
            if (this.dom.lightboxImage) {
                this.dom.lightboxImage.src = '';
            }
        }
    };

    // =========================================================================
    // WEATHER & DYNAMIC ATMOSPHERIC MOOD MANAGER
    // =========================================================================
    const weatherManager = {
        data: null,
        isAmbientEnabled: localStorage.getItem('dashboard_ambient_weather') !== 'false',
        pollTimer: null,
        animFrameId: null,
        canvas: null,
        ctx: null,
        particles: [],
        splashes: [],
        lightningTimer: 0,
        lightningAlpha: 0,
        currentCondition: 'clear',
        isDay: 1,
        precipitation: 0,
        lastFrameTime: 0,

        init() {
            this.cacheDOM();
            this.bindEvents();
            this.initCanvas();
            this.fetchWeather(false);

            // Auto-refresh weather every 15 minutes (900,000 ms)
            this.pollTimer = setInterval(() => {
                this.fetchWeather(false);
            }, 900000);

            // Hook Page Visibility API to pause rendering when tab is hidden
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    this.stopAnimation();
                } else {
                    if (this.isAmbientEnabled) {
                        this.startAnimation();
                    }
                }
            });

            window.weatherManager = this;
        },

        cacheDOM() {
            this.dom = {
                wrapper: document.getElementById('weather-flyout-wrapper'),
                btnWeather: document.getElementById('btn-header-weather'),
                headerIcon: document.getElementById('header-weather-icon'),
                headerTemp: document.getElementById('header-weather-temp'),
                headerCity: document.getElementById('header-weather-city'),
                flyoutCard: document.getElementById('weather-flyout-card'),
                flyoutIconLarge: document.getElementById('weather-flyout-icon-large'),
                flyoutCity: document.getElementById('weather-flyout-city'),
                dayNightChip: document.getElementById('weather-day-night-chip'),
                flyoutCondition: document.getElementById('weather-flyout-condition'),
                btnRefresh: document.getElementById('btn-weather-refresh'),
                btnClose: document.getElementById('btn-close-weather-flyout'),
                flyoutTemp: document.getElementById('weather-flyout-temp'),
                flyoutApparent: document.getElementById('weather-flyout-apparent'),
                lastUpdated: document.getElementById('weather-last-updated'),
                metricHumidity: document.getElementById('weather-metric-humidity'),
                metricWind: document.getElementById('weather-metric-wind'),
                metricPrecip: document.getElementById('weather-metric-precip'),
                metricCoords: document.getElementById('weather-metric-coords'),
                hourlyTimeline: document.getElementById('weather-hourly-timeline'),
                toggleAmbient: document.getElementById('toggle-ambient-weather'),
                canvas: document.getElementById('ambient-weather-canvas')
            };
        },

        bindEvents() {
            if (this.dom.btnWeather) {
                this.dom.btnWeather.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleFlyout();
                });
            }

            if (this.dom.btnClose) {
                this.dom.btnClose.addEventListener('click', () => this.closeFlyout());
            }

            if (this.dom.btnRefresh) {
                this.dom.btnRefresh.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.dom.btnRefresh) {
                        this.dom.btnRefresh.style.transform = 'rotate(360deg)';
                        this.dom.btnRefresh.style.transition = 'transform 0.6s ease';
                        setTimeout(() => {
                            if (this.dom.btnRefresh) this.dom.btnRefresh.style.transform = '';
                        }, 650);
                    }
                    this.fetchWeather(true);
                });
            }

            if (this.dom.toggleAmbient) {
                this.dom.toggleAmbient.checked = this.isAmbientEnabled;
                this.dom.toggleAmbient.addEventListener('change', (e) => {
                    this.setAmbientEnabled(e.target.checked);
                    if (window.featureManager) {
                        window.featureManager.setFeature('ambient_weather_effect', e.target.checked);
                    }
                });
            }

            // Close flyout when clicking outside
            document.addEventListener('click', (e) => {
                if (this.dom.flyoutCard && !this.dom.flyoutCard.classList.contains('hidden')) {
                    if (this.dom.wrapper && !this.dom.wrapper.contains(e.target)) {
                        this.closeFlyout();
                    }
                }
            });

            // Close flyout on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.dom.flyoutCard && !this.dom.flyoutCard.classList.contains('hidden')) {
                    this.closeFlyout();
                }
            });
        },

        toggleFlyout() {
            if (!this.dom.flyoutCard) return;
            const isHidden = this.dom.flyoutCard.classList.contains('hidden');
            if (isHidden) {
                // Close other flyouts if open
                if (elements.aiCopilotFlyout) elements.aiCopilotFlyout.classList.add('hidden');
                const notifDropdown = document.getElementById('notif-overview-dropdown');
                if (notifDropdown) notifDropdown.classList.add('hidden');

                this.dom.flyoutCard.classList.remove('hidden');
            } else {
                this.dom.flyoutCard.classList.add('hidden');
            }
        },

        closeFlyout() {
            if (this.dom.flyoutCard) {
                this.dom.flyoutCard.classList.add('hidden');
            }
        },

        setAmbientEnabled(enabled) {
            this.isAmbientEnabled = !!enabled;
            localStorage.setItem('dashboard_ambient_weather', this.isAmbientEnabled ? 'true' : 'false');
            if (this.dom.toggleAmbient) {
                this.dom.toggleAmbient.checked = this.isAmbientEnabled;
            }

            if (this.dom.canvas) {
                this.dom.canvas.classList.toggle('disabled', !this.isAmbientEnabled);
            }

            if (this.isAmbientEnabled) {
                this.startAnimation();
                showActionToast('🌧️ Đã kích hoạt hiệu ứng Canvas môi trường thời tiết');
            } else {
                this.stopAnimation();
                this.clearCanvas();
                showActionToast('🔇 Đã tắt hiệu ứng Canvas môi trường');
            }
        },

        async fetchWeather(force = false) {
            try {
                if (this.dom.headerCity && !this.data) {
                    this.dom.headerCity.textContent = 'Đang tải...';
                }

                const res = await fetch(`/api/weather?force=${force}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                this.data = data;
                this.renderUI(data);

                this.currentCondition = data.weather_condition || 'clear';
                this.isDay = data.is_day !== undefined ? data.is_day : 1;
                this.precipitation = data.precipitation || 0;

                this.resetParticles();
                if (this.isAmbientEnabled && !document.hidden) {
                    this.startAnimation();
                }

                if (force) {
                    showActionToast(`🌤️ Đã làm mới thời tiết tại: ${data.city || 'Vị trí hiện tại'}`);
                }
            } catch (err) {
                console.warn('Weather fetch error:', err);
                if (this.dom.headerTemp) this.dom.headerTemp.textContent = '--°C';
                if (this.dom.headerCity) this.dom.headerCity.textContent = 'Offline';
            }
        },

        renderUI(data) {
            if (!data) return;

            // 1. Header Mini Button
            if (this.dom.headerIcon) this.dom.headerIcon.textContent = data.condition_icon || '🌤️';
            if (this.dom.headerTemp) this.dom.headerTemp.textContent = `${Math.round(data.temp)}°C`;
            if (this.dom.headerCity) this.dom.headerCity.textContent = data.city || 'Hà Nội';

            // 2. Detailed Flyout Header
            if (this.dom.flyoutIconLarge) this.dom.flyoutIconLarge.textContent = data.condition_icon || '🌤️';
            if (this.dom.flyoutCity) {
                this.dom.flyoutCity.textContent = `${data.city || 'Hà Nội'}, ${data.country || 'Vietnam'}`;
                this.dom.flyoutCity.title = `${data.city || 'Hà Nội'}, ${data.country || 'Vietnam'}`;
            }

            if (this.dom.dayNightChip) {
                const isDay = data.is_day === 1;
                this.dom.dayNightChip.className = `weather-tag-pill ${isDay ? 'day' : 'night'}`;
                this.dom.dayNightChip.textContent = isDay ? '☀️ Ban ngày' : '🌙 Ban đêm';
            }

            if (this.dom.flyoutCondition) {
                this.dom.flyoutCondition.textContent = data.condition_text || 'Trời quang đãng, mát mẻ';
            }

            // 3. Main Banner
            if (this.dom.flyoutTemp) this.dom.flyoutTemp.textContent = data.temp !== undefined ? data.temp.toFixed(1) : '--';
            if (this.dom.flyoutApparent) this.dom.flyoutApparent.textContent = `${data.apparent_temp !== undefined ? data.apparent_temp.toFixed(1) : data.temp}°C`;
            if (this.dom.lastUpdated) this.dom.lastUpdated.textContent = `Cập nhật: ${data.updated_at || '--:--:--'}`;

            // 4. Metrics Grid
            if (this.dom.metricHumidity) this.dom.metricHumidity.textContent = `${data.humidity || 0}%`;
            if (this.dom.metricWind) this.dom.metricWind.textContent = `${data.wind_speed || 0} km/h`;
            if (this.dom.metricPrecip) this.dom.metricPrecip.textContent = `${data.precipitation || 0.0} mm`;
            if (this.dom.metricCoords) {
                const lat = data.latitude ? data.latitude.toFixed(2) : '21.03';
                const lon = data.longitude ? data.longitude.toFixed(2) : '105.85';
                this.dom.metricCoords.textContent = `${lat}°, ${lon}°`;
            }

            // 5. Hourly Forecast
            if (this.dom.hourlyTimeline) {
                const forecast = data.hourly_forecast || [];
                if (forecast.length === 0) {
                    this.dom.hourlyTimeline.innerHTML = '<div style="padding:10px;font-size:0.75rem;color:var(--text-muted);">Không có dữ liệu dự báo</div>';
                } else {
                    this.dom.hourlyTimeline.innerHTML = forecast.map((item, idx) => {
                        return `
                            <div class="weather-hourly-card ${idx === 0 ? 'active' : ''}">
                                <span class="hourly-time">${item.time || '--:--'}</span>
                                <span class="hourly-icon">${item.icon || '🌤️'}</span>
                                <span class="hourly-temp mono-text">${Math.round(item.temp)}°</span>
                            </div>
                        `;
                    }).join('');
                }
            }
        },

        // =====================================================================
        // Dynamic Atmospheric Canvas Engine (Ultra-lightweight Particle System)
        // =====================================================================
        initCanvas() {
            this.canvas = this.dom.canvas;
            if (!this.canvas) return;
            this.ctx = this.canvas.getContext('2d', { alpha: true });

            this.resizeCanvas();
            window.addEventListener('resize', () => {
                this.resizeCanvas();
                this.resetParticles();
            });

            if (this.isAmbientEnabled) {
                this.dom.canvas.classList.remove('disabled');
            } else {
                this.dom.canvas.classList.add('disabled');
            }
        },

        resizeCanvas() {
            if (!this.canvas) return;
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        },

        clearCanvas() {
            if (this.ctx && this.canvas) {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            }
        },

        resetParticles() {
            if (!this.canvas) return;
            const w = this.canvas.width;
            const h = this.canvas.height;
            this.particles = [];
            this.splashes = [];

            const cond = this.currentCondition;
            const isNight = this.isDay === 0;

            if (cond === 'rain' || cond === 'drizzle' || cond === 'thunderstorm') {
                const count = cond === 'drizzle' ? 60 : cond === 'thunderstorm' ? 140 : 95;
                for (let i = 0; i < count; i++) {
                    this.particles.push({
                        x: Math.random() * (w + 200) - 100,
                        y: Math.random() * h,
                        length: 12 + Math.random() * 18,
                        vx: 1.5 + Math.random() * 1.5,
                        vy: 14 + Math.random() * 10,
                        opacity: 0.25 + Math.random() * 0.45,
                        width: 0.8 + Math.random() * 0.7
                    });
                }
            } else if (cond === 'snow') {
                const count = 70;
                for (let i = 0; i < count; i++) {
                    this.particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        radius: 1.2 + Math.random() * 2.2,
                        vx: -0.5 + Math.random() * 1.0,
                        vy: 0.8 + Math.random() * 1.6,
                        opacity: 0.3 + Math.random() * 0.5,
                        sway: Math.random() * Math.PI * 2,
                        swaySpeed: 0.02 + Math.random() * 0.03
                    });
                }
            } else if (cond === 'fog' || cond === 'cloudy') {
                const count = 18;
                for (let i = 0; i < count; i++) {
                    this.particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        radius: 80 + Math.random() * 140,
                        vx: 0.15 + Math.random() * 0.35,
                        opacity: 0.03 + Math.random() * 0.06
                    });
                }
            } else if (isNight) {
                // Clear Night: Starlight & Twinkles
                const count = 75;
                for (let i = 0; i < count; i++) {
                    this.particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        radius: 0.7 + Math.random() * 1.6,
                        baseAlpha: 0.2 + Math.random() * 0.6,
                        twinklePhase: Math.random() * Math.PI * 2,
                        twinkleSpeed: 0.02 + Math.random() * 0.04,
                        color: Math.random() > 0.3 ? '#ffffff' : Math.random() > 0.5 ? '#bcf846' : '#38bdf8'
                    });
                }
                // Shooting star placeholder
                this.shootingStar = { active: false, x: 0, y: 0, vx: 0, vy: 0, length: 0, opacity: 0 };
                this.shootingStarTimer = 300 + Math.random() * 500;
            } else {
                // Sunny / Clear Day: Warm floating golden dust motes
                const count = 45;
                for (let i = 0; i < count; i++) {
                    this.particles.push({
                        x: Math.random() * w,
                        y: Math.random() * h,
                        radius: 1.0 + Math.random() * 2.2,
                        vx: -0.3 + Math.random() * 0.6,
                        vy: -0.2 - Math.random() * 0.5,
                        opacity: 0.15 + Math.random() * 0.35,
                        sway: Math.random() * Math.PI * 2,
                        color: Math.random() > 0.4 ? 'rgba(251, 191, 36, ' : 'rgba(194, 248, 59, '
                    });
                }
            }
        },

        startAnimation() {
            if (this.animFrameId) cancelAnimationFrame(this.animFrameId);
            this.lastFrameTime = performance.now();
            const loop = (timestamp) => {
                if (!this.isAmbientEnabled || document.hidden) return;

                // Limit frame rate to ~45-60 FPS
                const elapsed = timestamp - this.lastFrameTime;
                if (elapsed >= 16) {
                    this.lastFrameTime = timestamp;
                    this.renderFrame();
                }
                this.animFrameId = requestAnimationFrame(loop);
            };
            this.animFrameId = requestAnimationFrame(loop);
        },

        stopAnimation() {
            if (this.animFrameId) {
                cancelAnimationFrame(this.animFrameId);
                this.animFrameId = null;
            }
        },

        renderFrame() {
            if (!this.ctx || !this.canvas) return;
            const w = this.canvas.width;
            const h = this.canvas.height;
            const ctx = this.ctx;

            ctx.clearRect(0, 0, w, h);

            const cond = this.currentCondition;
            const isNight = this.isDay === 0;

            if (cond === 'rain' || cond === 'drizzle' || cond === 'thunderstorm') {
                this.renderRain(ctx, w, h, cond);
            } else if (cond === 'snow') {
                this.renderSnow(ctx, w, h);
            } else if (cond === 'fog' || cond === 'cloudy') {
                this.renderFog(ctx, w, h);
            } else if (isNight) {
                this.renderStars(ctx, w, h);
            } else {
                this.renderSunDust(ctx, w, h);
            }
        },

        renderRain(ctx, w, h, cond) {
            // Thunderstorm Sheet Lightning
            if (cond === 'thunderstorm') {
                this.lightningTimer++;
                if (this.lightningTimer > 320 && Math.random() < 0.015) {
                    this.lightningAlpha = 0.12 + Math.random() * 0.08;
                    this.lightningTimer = 0;
                }
                if (this.lightningAlpha > 0.005) {
                    ctx.fillStyle = `rgba(215, 235, 255, ${this.lightningAlpha})`;
                    ctx.fillRect(0, 0, w, h);
                    this.lightningAlpha *= 0.88;
                }
            }

            // Rain Streaks
            ctx.lineWidth = 1;
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                p.x += p.vx;
                p.y += p.vy;

                // Gradient rain streak
                const grad = ctx.createLinearGradient(p.x, p.y, p.x + p.vx * 1.5, p.y + p.length);
                grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
                grad.addColorStop(1, `rgba(56, 189, 248, ${p.opacity})`);

                ctx.strokeStyle = grad;
                ctx.lineWidth = p.width;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + p.vx * 1.5, p.y + p.length);
                ctx.stroke();

                // Hit ground splash
                if (p.y > h - 40) {
                    if (Math.random() < 0.18 && this.splashes.length < 25) {
                        this.splashes.push({
                            x: p.x,
                            y: h - 10 + Math.random() * 8,
                            rx: 2,
                            ry: 1,
                            maxRx: 7 + Math.random() * 8,
                            opacity: 0.35
                        });
                    }
                    p.y = -20 - Math.random() * 30;
                    p.x = Math.random() * (w + 200) - 100;
                }
                if (p.x > w + 50) {
                    p.x = -30;
                }
            }

            // Render Splashes
            for (let j = this.splashes.length - 1; j >= 0; j--) {
                const s = this.splashes[j];
                s.rx += 0.45;
                s.ry = s.rx * 0.35;
                s.opacity *= 0.89;

                ctx.strokeStyle = `rgba(56, 189, 248, ${s.opacity})`;
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.ellipse(s.x, s.y, s.rx, s.ry, 0, 0, Math.PI * 2);
                ctx.stroke();

                if (s.opacity < 0.02 || s.rx > s.maxRx) {
                    this.splashes.splice(j, 1);
                }
            }
        },

        renderSnow(ctx, w, h) {
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                p.sway += p.swaySpeed;
                p.x += p.vx + Math.sin(p.sway) * 0.6;
                p.y += p.vy;

                ctx.fillStyle = `rgba(255, 255, 255, ${p.opacity})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();

                if (p.y > h + 10) {
                    p.y = -10;
                    p.x = Math.random() * w;
                }
                if (p.x < -10) p.x = w + 5;
                if (p.x > w + 10) p.x = -5;
            }
        },

        renderFog(ctx, w, h) {
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                p.x += p.vx;
                if (p.x - p.radius > w) p.x = -p.radius;

                const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
                grad.addColorStop(0, `rgba(148, 163, 184, ${p.opacity})`);
                grad.addColorStop(1, 'rgba(148, 163, 184, 0)');

                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        renderStars(ctx, w, h) {
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                p.twinklePhase += p.twinkleSpeed;
                const alpha = p.baseAlpha + Math.sin(p.twinklePhase) * 0.25;
                const clampedAlpha = Math.max(0.05, Math.min(0.9, alpha));

                ctx.fillStyle = p.color;
                ctx.globalAlpha = clampedAlpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1.0;
        },

        renderSunDust(ctx, w, h) {
            for (let i = 0; i < this.particles.length; i++) {
                const p = this.particles[i];
                p.sway += 0.02;
                p.x += p.vx + Math.sin(p.sway) * 0.3;
                p.y += p.vy;

                ctx.fillStyle = `${p.color}${p.opacity})`;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();

                if (p.y < -10) {
                    p.y = h + 10;
                    p.x = Math.random() * w;
                }
                if (p.x < -10) p.x = w + 5;
                if (p.x > w + 10) p.x = -5;
            }
        }
    };

    // =========================================================================
    // TAB 11: AI PROMPT & CODE SNIPPET LABORATORY MODULE
    // =========================================================================
    const snippetLabManager = {
        state: {
            snippets: [],
            selectedSnippet: null,
            activeCategory: 'all',
            activeTag: 'all',
            searchQuery: '',
            isLoading: false,
            isAiRunning: false,
            aiTimerStartTime: 0,
            aiTimerInterval: null,
            selectedAiModel: 'gemini-3.5-flash-lite',
            systemInstruction: '',
            lastAiResponseText: '',
        },
        dom: {},
        debounceTimer: null,

        init() {
            this.cacheDOM();
            this.bindEvents();
            window.snippetLabManager = this;
        },

        cacheDOM() {
            this.dom = {
                view: document.getElementById('view-snippet-lab'),
                btnNewSnippetTop: document.getElementById('btn-lab-new-snippet-top'),
                btnRefresh: document.getElementById('btn-lab-refresh'),
                btnResetDefaults: document.getElementById('btn-lab-reset-defaults'),

                // Left Column Library
                searchInput: document.getElementById('lab-search-input'),
                btnClearSearch: document.getElementById('btn-lab-clear-search'),
                categoryPills: document.getElementById('lab-category-pills'),
                tagsCloudWrap: document.getElementById('lab-tags-cloud-wrap'),
                tagsPillsList: document.getElementById('lab-tags-pills-list'),
                btnCreateSnippet: document.getElementById('btn-lab-create-snippet'),
                listCountText: document.getElementById('lab-list-count-text'),
                listHeaderTitle: document.getElementById('lab-list-header-title'),
                snippetsList: document.getElementById('lab-snippets-list'),
                countAll: document.getElementById('lab-count-all'),
                countAiPrompt: document.getElementById('lab-count-ai_prompt'),
                countPython: document.getElementById('lab-count-python'),
                countPowershell: document.getElementById('lab-count-powershell'),
                countBash: document.getElementById('lab-count-bash'),
                countDocker: document.getElementById('lab-count-docker'),
                countSql: document.getElementById('lab-count-sql'),
                countCsharp: document.getElementById('lab-count-csharp'),

                // Right Column Editor
                inputTitle: document.getElementById('lab-input-title'),
                selectCategory: document.getElementById('lab-select-category'),
                inputTags: document.getElementById('lab-input-tags'),
                inputDesc: document.getElementById('lab-input-desc'),
                statChars: document.getElementById('lab-stat-chars'),
                statWords: document.getElementById('lab-stat-words'),
                statLines: document.getElementById('lab-stat-lines'),
                statTokens: document.getElementById('lab-stat-tokens'),
                tokenGaugeFill: document.getElementById('lab-token-gauge-fill'),
                tokenGaugeLabel: document.getElementById('lab-token-gauge-label'),
                editorLangBadge: document.getElementById('lab-editor-lang-badge'),
                editorModeTag: document.getElementById('lab-editor-mode-tag'),
                editorCanvas: document.getElementById('lab-editor-canvas'),
                lineNumbersGutter: document.getElementById('lab-line-numbers-gutter'),
                codeTextarea: document.getElementById('lab-code-textarea'),
                btnCopyContent: document.getElementById('btn-lab-copy-content'),
                btnCopyText: document.getElementById('btn-lab-copy-text'),
                btnSaveSnippet: document.getElementById('btn-lab-save-snippet'),
                btnSaveText: document.getElementById('btn-lab-save-text'),
                btnClearForm: document.getElementById('btn-lab-clear-form'),
                btnDeleteCurrent: document.getElementById('btn-lab-delete-current'),
                btnTestAi: document.getElementById('btn-lab-test-ai'),

                // AI Playground
                aiPlaygroundPanel: document.getElementById('lab-ai-playground-panel'),
                selectAiModel: document.getElementById('lab-select-ai-model'),
                btnToggleSysInstruction: document.getElementById('btn-lab-toggle-sys-instruction'),
                sysInstructionWrap: document.getElementById('lab-system-instruction-wrap'),
                sysInstructionInput: document.getElementById('lab-system-instruction-input'),
                btnCloseAiPanel: document.getElementById('btn-lab-close-ai-panel'),
                aiLoadingState: document.getElementById('lab-ai-loading-state'),
                aiTimerLive: document.getElementById('lab-ai-timer-live'),
                aiResponseCard: document.getElementById('lab-ai-response-card'),
                resEngineBadge: document.getElementById('lab-res-engine-badge'),
                resLatencyBadge: document.getElementById('lab-res-latency-badge'),
                resTokensBadge: document.getElementById('lab-res-tokens-badge'),
                aiResponseContent: document.getElementById('lab-ai-response-content'),
                btnCopyAiResponse: document.getElementById('btn-lab-copy-ai-response'),
                btnCopyResText: document.getElementById('btn-lab-copy-res-text'),
                btnSaveAiSnippet: document.getElementById('btn-lab-save-ai-snippet'),
            };
        },

        bindEvents() {
            // Top buttons
            if (this.dom.btnNewSnippetTop) {
                this.dom.btnNewSnippetTop.addEventListener('click', () => this.createNewSnippet());
            }
            if (this.dom.btnRefresh) {
                this.dom.btnRefresh.addEventListener('click', () => {
                    this.fetchSnippets(true);
                    showActionToast('🔄 Đã làm mới kho Snippet & Prompt.');
                });
            }
            if (this.dom.btnResetDefaults) {
                this.dom.btnResetDefaults.addEventListener('click', () => this.resetDefaultTemplates());
            }

            // Left search & filters
            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', (e) => {
                    const val = e.target.value;
                    this.state.searchQuery = val;
                    if (this.dom.btnClearSearch) {
                        this.dom.btnClearSearch.classList.toggle('hidden', !val);
                    }
                    clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        this.fetchSnippets(false);
                    }, 250);
                });
            }

            if (this.dom.btnClearSearch) {
                this.dom.btnClearSearch.addEventListener('click', () => {
                    if (this.dom.searchInput) this.dom.searchInput.value = '';
                    this.state.searchQuery = '';
                    this.dom.btnClearSearch.classList.add('hidden');
                    this.fetchSnippets(false);
                });
            }

            if (this.dom.categoryPills) {
                this.dom.categoryPills.addEventListener('click', (e) => {
                    const btn = e.target.closest('.lab-cat-pill');
                    if (!btn) return;
                    const cat = btn.getAttribute('data-category');
                    if (cat === this.state.activeCategory) return;
                    this.setCategory(cat);
                });
            }

            if (this.dom.btnCreateSnippet) {
                this.dom.btnCreateSnippet.addEventListener('click', () => this.createNewSnippet());
            }

            // Editor Inputs & Events
            if (this.dom.selectCategory) {
                this.dom.selectCategory.addEventListener('change', (e) => {
                    this.updateCategoryBadge(e.target.value);
                });
            }

            if (this.dom.codeTextarea) {
                this.dom.codeTextarea.addEventListener('input', () => {
                    const val = this.dom.codeTextarea.value;
                    this.updateTokenStats(val);
                    this.syncLineNumbers(val);
                });

                this.dom.codeTextarea.addEventListener('scroll', () => {
                    if (this.dom.lineNumbersGutter) {
                        this.dom.lineNumbersGutter.scrollTop = this.dom.codeTextarea.scrollTop;
                    }
                });

                this.dom.codeTextarea.addEventListener('keydown', (e) => this.handleEditorKeydown(e));
            }

            // Action Buttons
            if (this.dom.btnCopyContent) {
                this.dom.btnCopyContent.addEventListener('click', () => {
                    const content = this.dom.codeTextarea ? this.dom.codeTextarea.value : '';
                    this.copyToClipboard(content, this.dom.btnCopyText, '📋 Sao Chép (1-Click Copy)');
                });
            }

            if (this.dom.btnSaveSnippet) {
                this.dom.btnSaveSnippet.addEventListener('click', () => this.saveSnippet());
            }

            if (this.dom.btnClearForm) {
                this.dom.btnClearForm.addEventListener('click', () => this.createNewSnippet());
            }

            if (this.dom.btnDeleteCurrent) {
                this.dom.btnDeleteCurrent.addEventListener('click', () => {
                    if (this.state.selectedSnippet && this.state.selectedSnippet.id) {
                        this.deleteSnippet(this.state.selectedSnippet.id);
                    }
                });
            }

            if (this.dom.btnTestAi) {
                this.dom.btnTestAi.addEventListener('click', () => this.testPromptWithAi());
            }

            // AI Playground Panel Events
            if (this.dom.btnToggleSysInstruction) {
                this.dom.btnToggleSysInstruction.addEventListener('click', () => {
                    if (this.dom.sysInstructionWrap) {
                        this.dom.sysInstructionWrap.classList.toggle('hidden');
                    }
                });
            }

            if (this.dom.btnCloseAiPanel) {
                this.dom.btnCloseAiPanel.addEventListener('click', () => {
                    if (this.dom.aiPlaygroundPanel) {
                        this.dom.aiPlaygroundPanel.classList.add('hidden');
                    }
                });
            }

            if (this.dom.btnCopyAiResponse) {
                this.dom.btnCopyAiResponse.addEventListener('click', () => {
                    const text = this.state.lastAiResponseText || (this.dom.aiResponseContent ? this.dom.aiResponseContent.innerText : '');
                    this.copyToClipboard(text, this.dom.btnCopyResText, 'Sao Chép');
                });
            }

            if (this.dom.btnSaveAiSnippet) {
                this.dom.btnSaveAiSnippet.addEventListener('click', () => this.saveAiResponseAsSnippet());
            }
        },

        onTabActivated() {
            if (this.state.snippets.length === 0) {
                this.fetchSnippets(true);
            }
            if (this.dom.codeTextarea) {
                this.updateTokenStats(this.dom.codeTextarea.value);
                this.syncLineNumbers(this.dom.codeTextarea.value);
            }
        },

        setCategory(cat) {
            this.state.activeCategory = cat;
            if (this.dom.categoryPills) {
                this.dom.categoryPills.querySelectorAll('.lab-cat-pill').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-category') === cat);
                });
            }
            this.fetchSnippets(false);
        },

        setTag(tag) {
            this.state.activeTag = tag;
            if (this.dom.tagsPillsList) {
                this.dom.tagsPillsList.querySelectorAll('.lab-tag-pill').forEach(btn => {
                    btn.classList.toggle('active', btn.getAttribute('data-tag') === tag);
                });
            }
            this.fetchSnippets(false);
        },

        async fetchSnippets(forceSelectFirst = false) {
            this.state.isLoading = true;
            try {
                let url = '/api/lab/snippets?';
                const params = new URLSearchParams();
                if (this.state.activeCategory && this.state.activeCategory !== 'all') {
                    params.append('category', this.state.activeCategory);
                }
                if (this.state.activeTag && this.state.activeTag !== 'all') {
                    params.append('tag', this.state.activeTag);
                }
                if (this.state.searchQuery && this.state.searchQuery.trim()) {
                    params.append('search', this.state.searchQuery.trim());
                }
                url += params.toString();

                const res = await fetch(url);
                const data = await res.json();
                if (data.status === 'success' && Array.isArray(data.snippets)) {
                    this.state.snippets = data.snippets;
                    this.renderSnippetsList(data.snippets);
                    this.renderCategoryCounts(data.snippets);
                    this.renderTagCloud(data.snippets);

                    // Select snippet
                    if (forceSelectFirst && data.snippets.length > 0) {
                        this.selectSnippet(data.snippets[0]);
                    } else if (this.state.selectedSnippet) {
                        const currentStillExists = data.snippets.find(s => s.id === this.state.selectedSnippet.id);
                        if (currentStillExists) {
                            this.selectSnippet(currentStillExists);
                        } else if (data.snippets.length > 0) {
                            this.selectSnippet(data.snippets[0]);
                        } else {
                            this.createNewSnippet();
                        }
                    } else if (data.snippets.length > 0) {
                        this.selectSnippet(data.snippets[0]);
                    } else {
                        this.createNewSnippet();
                    }
                }
            } catch (e) {
                console.error('Error fetching lab snippets:', e);
                if (this.dom.snippetsList) {
                    this.dom.snippetsList.innerHTML = `
                        <div class="lab-list-empty">
                            <span style="font-size:1.5rem;">⚠️</span>
                            <span>Không thể kết nối đến máy chủ lấy dữ liệu Snippets.</span>
                        </div>
                    `;
                }
            } finally {
                this.state.isLoading = false;
            }
        },

        renderCategoryCounts(snippets) {
            // Count total and per category
            const counts = {
                all: snippets.length,
                ai_prompt: 0,
                python: 0,
                powershell: 0,
                bash: 0,
                docker: 0,
                sql: 0,
                csharp: 0,
            };

            snippets.forEach(s => {
                const cat = (s.category || '').toLowerCase();
                if (counts[cat] !== undefined) {
                    counts[cat]++;
                }
            });

            if (this.dom.countAll) this.dom.countAll.textContent = counts.all;
            if (this.dom.countAiPrompt) this.dom.countAiPrompt.textContent = counts.ai_prompt;
            if (this.dom.countPython) this.dom.countPython.textContent = counts.python;
            if (this.dom.countPowershell) this.dom.countPowershell.textContent = counts.powershell;
            if (this.dom.countBash) this.dom.countBash.textContent = counts.bash;
            if (this.dom.countDocker) this.dom.countDocker.textContent = counts.docker;
            if (this.dom.countSql) this.dom.countSql.textContent = counts.sql;
            if (this.dom.countCsharp) this.dom.countCsharp.textContent = counts.csharp;
            if (this.dom.listCountText) this.dom.listCountText.textContent = `${snippets.length} mục`;
        },

        renderTagCloud(snippets) {
            if (!this.dom.tagsPillsList) return;
            const tagSet = new Set();
            snippets.forEach(s => {
                if (Array.isArray(s.tags)) {
                    s.tags.forEach(t => { if (t && t.trim()) tagSet.add(t.trim().toLowerCase()); });
                }
            });

            if (tagSet.size === 0) {
                this.dom.tagsPillsList.innerHTML = '<span style="font-size:0.7rem;color:var(--text-muted);">Không có tags</span>';
                return;
            }

            let html = `<button class="lab-tag-pill ${this.state.activeTag === 'all' ? 'active' : ''}" data-tag="all">#tất-cả</button>`;
            Array.from(tagSet).slice(0, 15).forEach(t => {
                const isActive = this.state.activeTag.toLowerCase() === t.toLowerCase();
                html += `<button class="lab-tag-pill ${isActive ? 'active' : ''}" data-tag="${t}">#${t}</button>`;
            });

            this.dom.tagsPillsList.innerHTML = html;

            this.dom.tagsPillsList.querySelectorAll('.lab-tag-pill').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tag = btn.getAttribute('data-tag');
                    this.setTag(tag);
                });
            });
        },

        renderSnippetsList(snippets) {
            if (!this.dom.snippetsList) return;

            if (snippets.length === 0) {
                this.dom.snippetsList.innerHTML = `
                    <div class="lab-list-empty">
                        <span style="font-size:1.8rem;">📦</span>
                        <strong style="color:var(--text-white);">Không tìm thấy Snippet nào</strong>
                        <p style="font-size:0.75rem;margin:0;">Hãy thử đổi từ khóa tìm kiếm hoặc bấm nút "+ Tạo Snippet Mới".</p>
                    </div>
                `;
                return;
            }

            const categoryLabels = {
                ai_prompt: { name: 'AI PROMPT', icon: '🤖' },
                python: { name: 'PYTHON', icon: '🐍' },
                powershell: { name: 'POWERSHELL', icon: '⚡' },
                bash: { name: 'BASH', icon: '🐚' },
                docker: { name: 'DOCKER', icon: '🐳' },
                sql: { name: 'SQL', icon: '🗄️' },
                csharp: { name: 'C# .NET', icon: '🔷' },
            };

            let html = '';
            snippets.forEach(s => {
                const cat = (s.category || 'ai_prompt').toLowerCase();
                const catMeta = categoryLabels[cat] || { name: cat.toUpperCase(), icon: '📄' };
                const isSelected = this.state.selectedSnippet && this.state.selectedSnippet.id === s.id;
                const tokenCount = s.token_stats ? s.token_stats.estimated_tokens : Math.round((s.content || '').length / 4);

                let tagsHtml = '';
                if (Array.isArray(s.tags) && s.tags.length > 0) {
                    tagsHtml = s.tags.slice(0, 3).map(t => `<span class="lab-card-tag-item">#${t}</span>`).join('');
                }

                html += `
                    <div class="lab-snippet-card ${isSelected ? 'active' : ''}" data-id="${s.id}">
                        <div class="lab-card-top-row">
                            <span class="lab-cat-badge cat-${cat}">
                                <span>${catMeta.icon}</span>
                                <span>${catMeta.name}</span>
                            </span>
                            <div class="lab-card-quick-actions">
                                <button class="lab-card-btn-copy" data-id="${s.id}" title="1-Click Copy to Clipboard">
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                </button>
                                <button class="lab-card-btn-delete" data-id="${s.id}" title="Xóa Snippet">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <h4 class="lab-card-title">${this.escapeHtml(s.title || 'Untitled Snippet')}</h4>
                        ${s.description ? `<p class="lab-card-desc">${this.escapeHtml(s.description)}</p>` : ''}

                        <div class="lab-card-footer">
                            <div class="lab-card-tags">${tagsHtml}</div>
                            <span class="lab-card-token-info">~${tokenCount} tokens</span>
                        </div>
                    </div>
                `;
            });

            this.dom.snippetsList.innerHTML = html;

            // Bind click to select card
            this.dom.snippetsList.querySelectorAll('.lab-snippet-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.lab-card-btn-copy') || e.target.closest('.lab-card-btn-delete')) {
                        return;
                    }
                    const id = card.getAttribute('data-id');
                    const snippet = this.state.snippets.find(s => s.id === id);
                    if (snippet) {
                        this.selectSnippet(snippet);
                    }
                });
            });

            // Bind Quick Copy buttons
            this.dom.snippetsList.querySelectorAll('.lab-card-btn-copy').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.getAttribute('data-id');
                    const snippet = this.state.snippets.find(s => s.id === id);
                    if (snippet && snippet.content) {
                        this.copyToClipboard(snippet.content, null);
                        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c2f83b" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                        setTimeout(() => {
                            btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                        }, 1800);
                    }
                });
            });

            // Bind Quick Delete buttons
            this.dom.snippetsList.querySelectorAll('.lab-card-btn-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = btn.getAttribute('data-id');
                    this.deleteSnippet(id);
                });
            });
        },

        selectSnippet(snippet) {
            this.state.selectedSnippet = snippet;

            // Highlight active card in left list
            if (this.dom.snippetsList) {
                this.dom.snippetsList.querySelectorAll('.lab-snippet-card').forEach(c => {
                    c.classList.toggle('active', c.getAttribute('data-id') === snippet.id);
                });
            }

            // Populate Form Fields
            if (this.dom.inputTitle) this.dom.inputTitle.value = snippet.title || '';
            if (this.dom.selectCategory) this.dom.selectCategory.value = snippet.category || 'ai_prompt';
            if (this.dom.inputTags) {
                this.dom.inputTags.value = Array.isArray(snippet.tags) ? snippet.tags.join(', ') : (snippet.tags || '');
            }
            if (this.dom.inputDesc) this.dom.inputDesc.value = snippet.description || '';
            if (this.dom.codeTextarea) this.dom.codeTextarea.value = snippet.content || '';

            // Update UI State
            this.updateCategoryBadge(snippet.category || 'ai_prompt');
            this.updateTokenStats(snippet.content || '');
            this.syncLineNumbers(snippet.content || '');

            if (this.dom.btnDeleteCurrent) this.dom.btnDeleteCurrent.classList.remove('hidden');
            if (this.dom.btnSaveText) this.dom.btnSaveText.textContent = '💾 Lưu Thay Đổi';
        },

        createNewSnippet() {
            this.state.selectedSnippet = null;

            // Unhighlight cards
            if (this.dom.snippetsList) {
                this.dom.snippetsList.querySelectorAll('.lab-snippet-card').forEach(c => c.classList.remove('active'));
            }

            // Reset Form Fields
            if (this.dom.inputTitle) {
                this.dom.inputTitle.value = '';
                this.dom.inputTitle.focus();
            }
            if (this.dom.selectCategory) this.dom.selectCategory.value = 'ai_prompt';
            if (this.dom.inputTags) this.dom.inputTags.value = '';
            if (this.dom.inputDesc) this.dom.inputDesc.value = '';
            if (this.dom.codeTextarea) {
                this.dom.codeTextarea.value = `[VAI TRÒ & MỤC TIÊU]\nBạn là một Chuyên gia AI. Hãy thực hiện tác vụ sau:\n\n[YÊU CẦU]:\n1. \n2. \n`;
            }

            this.updateCategoryBadge('ai_prompt');
            this.updateTokenStats(this.dom.codeTextarea ? this.dom.codeTextarea.value : '');
            this.syncLineNumbers(this.dom.codeTextarea ? this.dom.codeTextarea.value : '');

            if (this.dom.btnDeleteCurrent) this.dom.btnDeleteCurrent.classList.add('hidden');
            if (this.dom.btnSaveText) this.dom.btnSaveText.textContent = '💾 Tạo Mới Snippet';

            showActionToast('✨ Đã mở biểu mẫu tạo Snippet mới.');
        },

        updateCategoryBadge(category) {
            const cat = (category || 'ai_prompt').toLowerCase();
            const badgeMap = {
                ai_prompt: '🤖 AI PROMPT',
                python: '🐍 PYTHON 3.x',
                powershell: '⚡ POWERSHELL',
                bash: '🐚 BASH SHELL',
                docker: '🐳 DOCKER',
                sql: '🗄️ SQL QUERY',
                csharp: '🔷 C# .NET',
            };

            if (this.dom.editorLangBadge) {
                this.dom.editorLangBadge.textContent = badgeMap[cat] || `📄 ${cat.toUpperCase()}`;
            }
        },

        updateTokenStats(text) {
            if (!text) text = '';
            const chars = text.length;
            const words = text.trim() ? text.trim().split(/\s+/).length : 0;
            const lines = text ? text.split('\n').length : 1;

            // Heuristic Tokenization
            const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
            const latinChars = chars - cjkChars;
            const estimatedTokens = chars > 0 ? Math.max(1, Math.round((latinChars / 4.0) + (cjkChars * 1.5))) : 0;

            if (this.dom.statChars) this.dom.statChars.textContent = chars.toLocaleString();
            if (this.dom.statWords) this.dom.statWords.textContent = words.toLocaleString();
            if (this.dom.statLines) this.dom.statLines.textContent = lines.toLocaleString();
            if (this.dom.statTokens) this.dom.statTokens.textContent = estimatedTokens.toLocaleString();

            // Gauge progress bar against 128k context
            const maxContext = 128000;
            const pct = Math.min(100, Math.max(0.1, (estimatedTokens / maxContext) * 100));
            if (this.dom.tokenGaugeFill) {
                this.dom.tokenGaugeFill.style.width = `${chars > 0 ? pct.toFixed(2) : 0}%`;
            }
            if (this.dom.tokenGaugeLabel) {
                this.dom.tokenGaugeLabel.textContent = `${pct.toFixed(2)}% / 128k Window`;
            }
        },

        syncLineNumbers(text) {
            if (!this.dom.lineNumbersGutter) return;
            const lines = (text || '').split('\n');
            const totalLines = Math.max(1, lines.length);

            let gutterHtml = '';
            for (let i = 1; i <= totalLines; i++) {
                gutterHtml += `<span>${i}</span>`;
            }
            this.dom.lineNumbersGutter.innerHTML = gutterHtml;
        },

        handleEditorKeydown(e) {
            const textarea = this.dom.codeTextarea;
            if (!textarea) return;

            // Tab / Shift+Tab indent handling
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = textarea.value;

                if (!e.shiftKey) {
                    // Insert 4 spaces
                    textarea.value = value.substring(0, start) + '    ' + value.substring(end);
                    textarea.selectionStart = textarea.selectionEnd = start + 4;
                } else {
                    // Unindent 4 spaces
                    const before = value.substring(0, start);
                    if (before.endsWith('    ')) {
                        textarea.value = before.substring(0, before.length - 4) + value.substring(start);
                        textarea.selectionStart = textarea.selectionEnd = start - 4;
                    }
                }
                this.updateTokenStats(textarea.value);
                this.syncLineNumbers(textarea.value);
            } else if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveSnippet();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                this.testPromptWithAi();
            }
        },

        async saveSnippet() {
            const title = this.dom.inputTitle ? this.dom.inputTitle.value.trim() : '';
            const category = this.dom.selectCategory ? this.dom.selectCategory.value : 'ai_prompt';
            const rawTags = this.dom.inputTags ? this.dom.inputTags.value.trim() : '';
            const description = this.dom.inputDesc ? this.dom.inputDesc.value.trim() : '';
            const content = this.dom.codeTextarea ? this.dom.codeTextarea.value : '';

            if (!title) {
                showActionToast('⚠️ Vui lòng nhập tiêu đề cho Snippet!');
                if (this.dom.inputTitle) this.dom.inputTitle.focus();
                return;
            }

            if (!content || !content.trim()) {
                showActionToast('⚠️ Vui lòng nhập nội dung mã nguồn hoặc prompt!');
                if (this.dom.codeTextarea) this.dom.codeTextarea.focus();
                return;
            }

            const tagsList = rawTags ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : [];

            try {
                if (this.state.selectedSnippet && this.state.selectedSnippet.id) {
                    // Update existing
                    const snippetId = this.state.selectedSnippet.id;
                    const res = await fetch(`/api/lab/snippets/${snippetId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title,
                            category,
                            tags: tagsList,
                            description,
                            content
                        })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        showActionToast('✅ Đã lưu thay đổi Snippet thành công!');
                        await this.fetchSnippets(false);
                        if (data.snippet) this.selectSnippet(data.snippet);
                    } else {
                        showActionToast(`❌ Lỗi khi lưu: ${data.message || 'Unknown error'}`);
                    }
                } else {
                    // Create new
                    const res = await fetch('/api/lab/snippets', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            title,
                            category,
                            tags: tagsList,
                            description,
                            content
                        })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        showActionToast('✨ Đã tạo mới Snippet thành công!');
                        await this.fetchSnippets(false);
                        if (data.snippet) this.selectSnippet(data.snippet);
                    } else {
                        showActionToast(`❌ Lỗi khi tạo: ${data.message || 'Unknown error'}`);
                    }
                }
            } catch (e) {
                console.error('Error saving snippet:', e);
                showActionToast('❌ Không thể kết nối tới máy chủ để lưu Snippet.');
            }
        },

        async deleteSnippet(snippetId) {
            if (!confirm('Bạn có chắc chắn muốn xóa Snippet này không? Thao tác này không thể hoàn tác.')) {
                return;
            }

            try {
                const res = await fetch(`/api/lab/snippets/${snippetId}`, {
                    method: 'DELETE'
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showActionToast('🗑️ Đã xóa Snippet thành công.');
                    this.state.selectedSnippet = null;
                    await this.fetchSnippets(true);
                } else {
                    showActionToast(`❌ Không thể xóa Snippet: ${data.message || 'Unknown error'}`);
                }
            } catch (e) {
                console.error('Error deleting snippet:', e);
                showActionToast('❌ Lỗi kết nối khi xóa Snippet.');
            }
        },

        async resetDefaultTemplates() {
            if (!confirm('Khôi phục toàn bộ các mẫu Template gốc (Prompt & Scripts mẫu)? Các snippet tự tạo sẽ được giữ nguyên.')) {
                return;
            }

            try {
                const res = await fetch('/api/lab/snippets/reset-defaults', { method: 'POST' });
                const data = await res.json();
                if (data.status === 'success') {
                    showActionToast(`✨ Đã khôi phục ${data.reseeded_count} mẫu Template gốc.`);
                    await this.fetchSnippets(true);
                }
            } catch (e) {
                console.error('Error resetting templates:', e);
                showActionToast('❌ Lỗi khi khôi phục template.');
            }
        },

        copyToClipboard(text, btnTextElement, defaultLabel = 'Sao Chép') {
            if (!text) {
                showActionToast('⚠️ Không có nội dung để sao chép!');
                return;
            }

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    this.onCopySuccess(btnTextElement, defaultLabel);
                }).catch(() => {
                    this.fallbackCopy(text, btnTextElement, defaultLabel);
                });
            } else {
                this.fallbackCopy(text, btnTextElement, defaultLabel);
            }
        },

        fallbackCopy(text, btnTextElement, defaultLabel) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
                this.onCopySuccess(btnTextElement, defaultLabel);
            } catch (e) {
                showActionToast('❌ Không thể sao chép vào Clipboard.');
            }
            document.body.removeChild(ta);
        },

        onCopySuccess(btnTextElement, defaultLabel) {
            showActionToast('📋 Đã sao chép vào Clipboard thành công!');
            if (btnTextElement) {
                btnTextElement.textContent = '✅ Đã Sao Chép!';
                setTimeout(() => {
                    btnTextElement.textContent = defaultLabel;
                }, 2000);
            }
        },

        async testPromptWithAi() {
            const prompt = this.dom.codeTextarea ? this.dom.codeTextarea.value.trim() : '';
            if (!prompt) {
                showActionToast('⚠️ Vui lòng nhập nội dung Prompt để kiểm thử với AI!');
                if (this.dom.codeTextarea) this.dom.codeTextarea.focus();
                return;
            }

            const model = this.dom.selectAiModel ? this.dom.selectAiModel.value : 'gemini-3.5-flash-lite';
            const sysInstruction = this.dom.sysInstructionInput ? this.dom.sysInstructionInput.value.trim() : '';

            // Open Panel
            if (this.dom.aiPlaygroundPanel) this.dom.aiPlaygroundPanel.classList.remove('hidden');
            if (this.dom.aiLoadingState) this.dom.aiLoadingState.classList.remove('hidden');
            if (this.dom.aiResponseCard) this.dom.aiResponseCard.classList.add('hidden');

            // Start Stopwatch
            this.state.isAiRunning = true;
            this.state.aiTimerStartTime = performance.now();
            if (this.state.aiTimerInterval) clearInterval(this.state.aiTimerInterval);

            this.state.aiTimerInterval = setInterval(() => {
                const elapsedSec = ((performance.now() - this.state.aiTimerStartTime) / 1000).toFixed(1);
                if (this.dom.aiTimerLive) this.dom.aiTimerLive.textContent = `${elapsedSec}s`;
            }, 100);

            try {
                const res = await fetch('/api/lab/test-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prompt,
                        system_instruction: sysInstruction,
                        model: model === 'local' ? null : model
                    })
                });

                const data = await res.json();
                clearInterval(this.state.aiTimerInterval);
                this.state.isAiRunning = false;

                if (this.dom.aiLoadingState) this.dom.aiLoadingState.classList.add('hidden');
                if (this.dom.aiResponseCard) this.dom.aiResponseCard.classList.remove('hidden');

                if (data.status === 'success') {
                    this.state.lastAiResponseText = data.response;
                    const durationMs = data.duration_ms || Math.round(performance.now() - this.state.aiTimerStartTime);

                    if (this.dom.resEngineBadge) {
                        this.dom.resEngineBadge.textContent = data.engine === 'gemini' ? `⚡ ${data.model || 'Gemini Flash'}` : `⚡ ${data.model || 'Local Engine'}`;
                    }
                    if (this.dom.resLatencyBadge) {
                        this.dom.resLatencyBadge.textContent = `⏱️ ${durationMs}ms`;
                    }
                    if (this.dom.resTokensBadge) {
                        this.dom.resTokensBadge.textContent = `📊 Out: ~${data.response_tokens || 0} tokens`;
                    }

                    if (this.dom.aiResponseContent) {
                        this.dom.aiResponseContent.innerHTML = this.renderRichAiMarkdown(data.response);
                    }

                    showActionToast(`🚀 Đã nhận phản hồi AI (${durationMs}ms)!`);
                } else {
                    if (this.dom.aiResponseContent) {
                        this.dom.aiResponseContent.innerHTML = `<div style="color:#f87171;">⚠️ Lỗi thực thi AI: ${this.escapeHtml(data.message || 'Không có phản hồi')}</div>`;
                    }
                }
            } catch (e) {
                clearInterval(this.state.aiTimerInterval);
                this.state.isAiRunning = false;
                if (this.dom.aiLoadingState) this.dom.aiLoadingState.classList.add('hidden');
                if (this.dom.aiResponseCard) this.dom.aiResponseCard.classList.remove('hidden');
                if (this.dom.aiResponseContent) {
                    this.dom.aiResponseContent.innerHTML = `<div style="color:#f87171;">⚠️ Lỗi kết nối tới AI API endpoint: ${e.message}</div>`;
                }
            }
        },

        saveAiResponseAsSnippet() {
            const aiText = this.state.lastAiResponseText;
            if (!aiText) {
                showActionToast('⚠️ Chưa có phản hồi từ AI để lưu!');
                return;
            }

            const currentTitle = this.dom.inputTitle ? this.dom.inputTitle.value.trim() : 'AI Generated';
            this.createNewSnippet();

            if (this.dom.inputTitle) this.dom.inputTitle.value = `${currentTitle} [AI Response]`;
            if (this.dom.selectCategory) this.dom.selectCategory.value = 'python';
            if (this.dom.inputTags) this.dom.inputTags.value = 'ai-output, gemini, generated';
            if (this.dom.inputDesc) this.dom.inputDesc.value = 'Kết quả được trích xuất từ AI Prompt Execution Playground.';
            if (this.dom.codeTextarea) {
                this.dom.codeTextarea.value = aiText;
                this.updateTokenStats(aiText);
                this.syncLineNumbers(aiText);
            }

            showActionToast('📥 Đã nạp phản hồi AI vào trình soạn thảo! Bấm "Lưu Thay Đổi" để lưu.');
        },

        renderRichAiMarkdown(text) {
            if (!text) return '';

            // Handle fenced code blocks with copy buttons
            let formatted = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
                const escapedCode = this.escapeHtml(code.trim());
                return `
                    <div class="code-block-wrapper" style="position:relative;margin:12px 0;">
                        <div style="display:flex;align-items:center;justify-content:space-between;background:#151b23;padding:4px 12px;border-radius:6px 6px 0 0;border:1px solid rgba(255,255,255,0.08);border-bottom:none;">
                            <span style="font-size:0.7rem;font-family:var(--font-mono);color:#94a3b8;font-weight:700;">${lang || 'CODE'}</span>
                            <button class="btn-copy-code-block" style="background:rgba(255,255,255,0.08);border:none;color:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:0.68rem;cursor:pointer;" onclick="navigator.clipboard.writeText(this.closest('.code-block-wrapper').querySelector('code').innerText);showActionToast('📋 Đã sao chép đoạn code!');">Copy</button>
                        </div>
                        <pre style="margin:0;border-radius:0 0 6px 6px;"><code class="language-${lang}">${escapedCode}</code></pre>
                    </div>
                `;
            });

            // Convert Headers
            formatted = formatted
                .replace(/^### (.*$)/gim, '<h4 style="color:#ffffff;margin:14px 0 6px;font-size:0.95rem;">$1</h4>')
                .replace(/^## (.*$)/gim, '<h3 style="color:var(--accent-lime);margin:16px 0 8px;font-size:1.05rem;">$1</h3>')
                .replace(/^# (.*$)/gim, '<h2 style="color:var(--accent-lime);margin:18px 0 10px;font-size:1.2rem;">$1</h2>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;color:#a7f3d0;">$1</code>')
                .replace(/^\s*[-*+]\s+(.*$)/gim, '<li style="margin-left:20px;margin-bottom:4px;">$1</li>')
                .replace(/\n/g, '<br>');

            return formatted;
        },

        escapeHtml(str) {
            if (!str) return '';
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }
    };

    // =========================================================================
    // MODULE CONTROL CENTER (FEATURE TOGGLE DECK & LIFECYCLE CONTROLLER)
    // =========================================================================
    const DEFAULT_FEATURES = {
        tab_overview: true,
        tab_disk: true,
        tab_apps: true,
        tab_power: true,
        tab_downloads: true,
        tab_radar: true,
        tab_alerts: true,
        tab_notifications: true,
        tab_focus: true,
        tab_lab: true,
        tab_wallpaper: true,
        tab_vocab: true,
        ai_jarvis_voice: true,
        ai_gemini_chat: true,
        widget_sidebar_actions: true,
        widget_sidebar_mini: true,
        widget_header_notif_bell: true,
        widget_cyber_pet: true,
        widget_sidebar_pet: true,
        widget_weather: true,
        ambient_weather_effect: true,
    };

    const FEATURE_CATEGORIES = {
        system: ['tab_overview', 'tab_disk', 'tab_apps', 'tab_power', 'tab_downloads'],
        network: ['tab_radar', 'tab_alerts', 'tab_notifications'],
        productivity: ['tab_focus', 'tab_lab', 'tab_wallpaper', 'tab_vocab'],
        widgets: [
            'ai_jarvis_voice',
            'ai_gemini_chat',
            'widget_sidebar_actions',
            'widget_sidebar_mini',
            'widget_header_notif_bell',
            'widget_cyber_pet',
            'widget_weather',
            'ambient_weather_effect'
        ]
    };

    const featureManager = {
        config: { ...DEFAULT_FEATURES },
        storageKey: 'dashboard_features_config',
        searchQuery: '',

        init() {
            this.loadConfig();
            this.cacheDOM();
            this.bindEvents();
            this.applyConfig(true); // Initial startup apply
            this.syncCheckboxUI();
            this.updateCountersAndChips();
            this.updatePresetButtonsState();
            window.featureManager = this;
        },

        loadConfig() {
            try {
                const raw = localStorage.getItem(this.storageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    this.config = { ...DEFAULT_FEATURES, ...parsed };
                    // Synchronize pet key alias
                    if (this.config.widget_cyber_pet !== undefined) {
                        this.config.widget_sidebar_pet = this.config.widget_cyber_pet;
                    }
                }
            } catch (e) {
                console.warn('Error loading feature config from localStorage:', e);
                this.config = { ...DEFAULT_FEATURES };
            }
        },

        saveConfig() {
            try {
                localStorage.setItem(this.storageKey, JSON.stringify(this.config));
            } catch (e) {
                console.error('Error saving feature config:', e);
            }
        },

        cacheDOM() {
            this.dom = {
                btnHeaderLauncher: document.getElementById('btn-header-feature-manager'),
                modal: document.getElementById('feature-manager-modal'),
                btnClose: document.getElementById('btn-close-feature-manager'),
                btnDone: document.getElementById('btn-done-feature-manager'),
                btnPresetAll: document.getElementById('btn-preset-all'),
                btnPresetMinimal: document.getElementById('btn-preset-minimal'),
                btnPresetDev: document.getElementById('btn-preset-dev'),
                btnPresetReset: document.getElementById('btn-preset-reset'),
                searchInput: document.getElementById('mcc-search-input'),
                btnClearSearch: document.getElementById('btn-mcc-clear-search'),
                searchEmpty: document.getElementById('mcc-search-empty'),
                btnResetSearchEmpty: document.getElementById('btn-mcc-reset-search-empty'),
                activeCountBadge: document.getElementById('mcc-active-count-badge'),
                checkboxes: document.querySelectorAll('.feature-matrix-body input[type="checkbox"][data-feature]'),
                cards: document.querySelectorAll('.feature-matrix-body .feature-toggle-card'),
                categoryGroups: document.querySelectorAll('.feature-category-group'),
                categoryCounters: document.querySelectorAll('.mcc-cat-counter'),
                categoryToggleBtns: document.querySelectorAll('.mcc-cat-toggle-btn'),
                statusChips: document.querySelectorAll('.toggle-status-chip'),
                sidebarQuickActions: document.querySelector('.sidebar-actions-group'),
                sidebarWidgets: document.querySelector('.sidebar-widgets'),
                sidebarCyberPet: document.getElementById('sidebar-cyber-pet-widget'),
                headerJarvisBtn: document.getElementById('btn-header-jarvis-voice'),
                jarvisCapsule: document.getElementById('jarvis-floating-capsule'),
                aiFlyoutWrapper: document.getElementById('ai-flyout-wrapper'),
                notifFlyoutWrapper: document.getElementById('notif-flyout-wrapper'),
                weatherFlyoutWrapper: document.getElementById('weather-flyout-wrapper'),
                ambientWeatherCanvas: document.getElementById('ambient-weather-canvas'),
            };
        },

        bindEvents() {
            if (this.dom.btnHeaderLauncher) {
                this.dom.btnHeaderLauncher.addEventListener('click', () => this.openModal());
            }

            if (this.dom.btnClose) {
                this.dom.btnClose.addEventListener('click', () => this.closeModal());
            }

            if (this.dom.btnDone) {
                this.dom.btnDone.addEventListener('click', () => this.closeModal());
            }

            if (this.dom.modal) {
                this.dom.modal.addEventListener('click', (e) => {
                    if (e.target === this.dom.modal) this.closeModal();
                });
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && this.dom.modal && !this.dom.modal.classList.contains('hidden')) {
                    this.closeModal();
                }
            });

            // Search filter input
            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', (e) => {
                    this.filterFeaturesBySearch(e.target.value);
                });
            }

            if (this.dom.btnClearSearch) {
                this.dom.btnClearSearch.addEventListener('click', () => {
                    if (this.dom.searchInput) this.dom.searchInput.value = '';
                    this.filterFeaturesBySearch('');
                });
            }

            if (this.dom.btnResetSearchEmpty) {
                this.dom.btnResetSearchEmpty.addEventListener('click', () => {
                    if (this.dom.searchInput) this.dom.searchInput.value = '';
                    this.filterFeaturesBySearch('');
                });
            }

            // Individual Checkbox Toggles
            if (this.dom.checkboxes) {
                this.dom.checkboxes.forEach(cb => {
                    cb.addEventListener('change', () => {
                        const featKey = cb.getAttribute('data-feature');
                        if (featKey) {
                            this.setFeature(featKey, cb.checked);
                        }
                    });
                });
            }

            // Category Bulk Toggles
            if (this.dom.categoryToggleBtns) {
                this.dom.categoryToggleBtns.forEach(btn => {
                    btn.addEventListener('click', () => {
                        const cat = btn.getAttribute('data-cat');
                        if (cat) {
                            this.toggleCategory(cat);
                        }
                    });
                });
            }

            // Presets
            if (this.dom.btnPresetAll) {
                this.dom.btnPresetAll.addEventListener('click', () => this.applyPreset('all'));
            }
            if (this.dom.btnPresetMinimal) {
                this.dom.btnPresetMinimal.addEventListener('click', () => this.applyPreset('minimal'));
            }
            if (this.dom.btnPresetDev) {
                this.dom.btnPresetDev.addEventListener('click', () => this.applyPreset('dev'));
            }
            if (this.dom.btnPresetReset) {
                this.dom.btnPresetReset.addEventListener('click', () => this.applyPreset('reset'));
            }
        },

        openModal() {
            if (this.dom.modal) {
                this.syncCheckboxUI();
                this.updateCountersAndChips();
                this.updatePresetButtonsState();
                if (this.dom.searchInput) this.dom.searchInput.value = '';
                this.filterFeaturesBySearch('');
                this.dom.modal.classList.remove('hidden');
            }
        },

        closeModal() {
            if (this.dom.modal) {
                this.dom.modal.classList.add('hidden');
            }
        },

        setFeature(key, enabled, silent = false) {
            const prevState = !!this.config[key];
            this.config[key] = !!enabled;

            // Sync pet aliases
            if (key === 'widget_cyber_pet' || key === 'widget_sidebar_pet') {
                this.config.widget_cyber_pet = !!enabled;
                this.config.widget_sidebar_pet = !!enabled;
            }

            this.saveConfig();

            // Execute Lifecycle Teardown / Activation Hook
            if (prevState !== !!enabled) {
                if (enabled) {
                    this.onFeatureEnabled(key);
                } else {
                    this.onFeatureDisabled(key);
                }
            }

            this.applyDOMState();
            this.syncCheckboxUI();
            this.updateCountersAndChips();
            this.updatePresetButtonsState();

            if (!silent) {
                showActionToast(`🎛️ Đã ${enabled ? 'kích hoạt' : 'ngắt & tắt hẳn'} module: ${this.getFeatureDisplayName(key)}`);
            }
        },

        toggleCategory(catName) {
            const featList = FEATURE_CATEGORIES[catName];
            if (!featList || featList.length === 0) return;

            // Check if all are currently active
            const allActive = featList.every(k => this.config[k] !== false);
            const targetState = !allActive;

            featList.forEach(k => {
                const prev = !!this.config[k];
                this.config[k] = targetState;
                if (k === 'widget_cyber_pet' || k === 'widget_sidebar_pet') {
                    this.config.widget_cyber_pet = targetState;
                    this.config.widget_sidebar_pet = targetState;
                }
                if (prev !== targetState) {
                    if (targetState) this.onFeatureEnabled(k);
                    else this.onFeatureDisabled(k);
                }
            });

            this.saveConfig();
            this.applyDOMState();
            this.syncCheckboxUI();
            this.updateCountersAndChips();
            this.updatePresetButtonsState();

            const catTitle = this.getCategoryDisplayName(catName);
            showActionToast(`⚡ Đã ${targetState ? 'bật toàn bộ' : 'tắt hẳn toàn bộ'} nhóm: ${catTitle}`);
        },

        applyPreset(presetName) {
            let targetConfig = { ...DEFAULT_FEATURES };

            if (presetName === 'minimal') {
                targetConfig = {
                    tab_overview: true,
                    tab_disk: false,
                    tab_apps: false,
                    tab_power: true,
                    tab_downloads: false,
                    tab_radar: true,
                    tab_alerts: false,
                    tab_notifications: false,
                    tab_focus: false,
                    tab_lab: false,
                    tab_wallpaper: false,
                    tab_vocab: false,
                    ai_jarvis_voice: false,
                    ai_gemini_chat: false,
                    widget_sidebar_actions: false,
                    widget_sidebar_mini: true,
                    widget_header_notif_bell: true,
                    widget_cyber_pet: false,
                    widget_sidebar_pet: false,
                    widget_weather: true,
                    ambient_weather_effect: false,
                };
            } else if (presetName === 'dev') {
                targetConfig = {
                    tab_overview: true,
                    tab_disk: true,
                    tab_apps: true,
                    tab_power: true,
                    tab_downloads: false,
                    tab_radar: true,
                    tab_alerts: true,
                    tab_notifications: false,
                    tab_focus: true,
                    tab_lab: true,
                    tab_wallpaper: true,
                    tab_vocab: true,
                    ai_jarvis_voice: true,
                    ai_gemini_chat: true,
                    widget_sidebar_actions: true,
                    widget_sidebar_mini: true,
                    widget_header_notif_bell: true,
                    widget_cyber_pet: true,
                    widget_sidebar_pet: true,
                    widget_weather: true,
                    ambient_weather_effect: true,
                };
            }

            // Apply lifecycles for all changed keys
            Object.keys(targetConfig).forEach(k => {
                const prev = !!this.config[k];
                const next = !!targetConfig[k];
                this.config[k] = next;
                if (prev !== next) {
                    if (next) this.onFeatureEnabled(k);
                    else this.onFeatureDisabled(k);
                }
            });

            this.saveConfig();
            this.applyDOMState();
            this.syncCheckboxUI();
            this.updateCountersAndChips();
            this.updatePresetButtonsState();
            showActionToast(`⚡ Đã áp dụng mẫu cấu hình: ${presetName.toUpperCase()}`);
        },

        onFeatureDisabled(key) {
            try {
                switch (key) {
                    case 'ai_jarvis_voice':
                        if (window.jarvisVoiceManager) {
                            window.jarvisVoiceManager.closeHUD();
                            window.jarvisVoiceManager.stopListening();
                            window.jarvisVoiceManager.stopSpeaking();
                            window.jarvisVoiceManager.stopMicAnalyser();
                        }
                        break;
                    case 'ai_gemini_chat':
                        if (elements.aiCopilotFlyout) {
                            elements.aiCopilotFlyout.classList.add('hidden');
                        }
                        if (typeof closeExpandedChatModal === 'function') {
                            closeExpandedChatModal();
                        }
                        break;
                    case 'tab_focus':
                        if (window.focusDeckManager) {
                            window.focusDeckManager.stopMatrix();
                            window.focusDeckManager.stopPomodoro();
                            window.focusDeckManager.stopAllChannels();
                            if (window.focusDeckManager.typewriterTimer) {
                                clearInterval(window.focusDeckManager.typewriterTimer);
                                window.focusDeckManager.typewriterTimer = null;
                            }
                        }
                        break;
                    case 'tab_radar':
                        if (window.networkRadarManager) {
                            window.networkRadarManager.stopSweepAnimation();
                            window.networkRadarManager.handleMouseLeave();
                        }
                        break;
                    case 'tab_power':
                        if (window.powerEstimatorManager) {
                            window.powerEstimatorManager.onTabDeactivated();
                        }
                        break;
                    case 'tab_wallpaper':
                        if (window.wallpaperManager) {
                            window.wallpaperManager.closeLightbox();
                        }
                        break;
                    case 'tab_lab':
                        if (window.snippetLabManager) {
                            if (window.snippetLabManager.dom && window.snippetLabManager.dom.aiPlaygroundPanel) {
                                window.snippetLabManager.dom.aiPlaygroundPanel.classList.add('hidden');
                            }
                            if (window.snippetLabManager.state && window.snippetLabManager.state.aiTimerInterval) {
                                clearInterval(window.snippetLabManager.state.aiTimerInterval);
                                window.snippetLabManager.state.aiTimerInterval = null;
                            }
                        }
                        break;
                    case 'tab_vocab':
                        if (window.speechSynthesis) {
                            window.speechSynthesis.cancel();
                        }
                        if (window.vocabManager) {
                            window.vocabManager.closeEditModal();
                        }
                        break;
                    case 'widget_cyber_pet':
                    case 'widget_sidebar_pet':
                        if (window.cyberPetManager && window.cyberPetManager.dialogueTimer) {
                            clearInterval(window.cyberPetManager.dialogueTimer);
                            window.cyberPetManager.dialogueTimer = null;
                        }
                        break;
                    case 'widget_weather':
                        if (window.weatherManager) {
                            window.weatherManager.closeFlyout();
                            if (window.weatherManager.pollTimer) {
                                clearInterval(window.weatherManager.pollTimer);
                                window.weatherManager.pollTimer = null;
                            }
                        }
                        break;
                    case 'ambient_weather_effect':
                        if (window.weatherManager) {
                            window.weatherManager.isAmbientEnabled = false;
                            window.weatherManager.stopAnimation();
                            window.weatherManager.clearCanvas();
                            if (window.weatherManager.dom && window.weatherManager.dom.canvas) {
                                window.weatherManager.dom.canvas.classList.add('disabled');
                            }
                            if (window.weatherManager.dom && window.weatherManager.dom.toggleAmbient) {
                                window.weatherManager.dom.toggleAmbient.checked = false;
                            }
                        }
                        break;
                    case 'widget_header_notif_bell':
                        if (elements.notifOverviewDropdown) {
                            elements.notifOverviewDropdown.classList.add('hidden');
                        }
                        break;
                }

                // Check background notification poll
                if (!this.config.tab_notifications && !this.config.widget_header_notif_bell) {
                    if (state.notifPollTimer) {
                        clearInterval(state.notifPollTimer);
                        state.notifPollTimer = null;
                    }
                }
            } catch (err) {
                console.warn(`[FeatureManager] Error during teardown of ${key}:`, err);
            }
        },

        onFeatureEnabled(key) {
            try {
                switch (key) {
                    case 'ambient_weather_effect':
                        if (window.weatherManager) {
                            window.weatherManager.isAmbientEnabled = true;
                            if (window.weatherManager.dom && window.weatherManager.dom.canvas) {
                                window.weatherManager.dom.canvas.classList.remove('disabled');
                            }
                            if (window.weatherManager.dom && window.weatherManager.dom.toggleAmbient) {
                                window.weatherManager.dom.toggleAmbient.checked = true;
                            }
                            if (!document.hidden) {
                                window.weatherManager.startAnimation();
                            }
                        }
                        break;
                    case 'widget_weather':
                        if (window.weatherManager) {
                            if (!window.weatherManager.pollTimer) {
                                window.weatherManager.pollTimer = setInterval(() => {
                                    window.weatherManager.fetchWeather(false);
                                }, 900000);
                            }
                            if (!window.weatherManager.data) {
                                window.weatherManager.fetchWeather(false);
                            }
                        }
                        break;
                    case 'widget_cyber_pet':
                    case 'widget_sidebar_pet':
                        if (window.cyberPetManager && !window.cyberPetManager.dialogueTimer) {
                            window.cyberPetManager.startTimers();
                        }
                        break;
                    case 'tab_focus':
                        if (state.activeTab === 'focus' && window.focusDeckManager) {
                            window.focusDeckManager.onTabActivated();
                        }
                        break;
                    case 'tab_radar':
                        if (state.activeTab === 'radar' && window.networkRadarManager) {
                            window.networkRadarManager.onTabActivated();
                        }
                        break;
                    case 'tab_power':
                        if (state.activeTab === 'power' && window.powerEstimatorManager) {
                            window.powerEstimatorManager.onTabActivated();
                        }
                        break;
                    case 'tab_wallpaper':
                        if (state.activeTab === 'wallpaper' && window.wallpaperManager) {
                            window.wallpaperManager.onTabActivated();
                        }
                        break;
                    case 'tab_lab':
                        if (state.activeTab === 'lab' && window.snippetLabManager) {
                            window.snippetLabManager.onTabActivated();
                        }
                        break;
                    case 'tab_vocab':
                        if (state.activeTab === 'vocab' && window.vocabManager) {
                            window.vocabManager.onTabActivated();
                        }
                        break;
                }

                // Check background notification poll
                if (this.config.tab_notifications || this.config.widget_header_notif_bell) {
                    if (!state.notifPollTimer && typeof fetchNotifications === 'function') {
                        state.notifPollTimer = setInterval(() => {
                            fetchNotifications(false);
                        }, 30000);
                    }
                }
            } catch (err) {
                console.warn(`[FeatureManager] Error during activation of ${key}:`, err);
            }
        },

        filterFeaturesBySearch(query) {
            const q = (query || '').toLowerCase().trim();
            this.searchQuery = q;

            if (this.dom.btnClearSearch) {
                this.dom.btnClearSearch.classList.toggle('hidden', !q);
            }

            let totalVisible = 0;

            if (this.dom.cards) {
                this.dom.cards.forEach(card => {
                    const featKey = card.getAttribute('data-feature-card') || '';
                    const title = (card.querySelector('.toggle-card-title')?.textContent || '').toLowerCase();
                    const desc = (card.querySelector('.toggle-card-desc')?.textContent || '').toLowerCase();
                    const keyStr = featKey.toLowerCase();

                    const matches = !q || title.includes(q) || desc.includes(q) || keyStr.includes(q);
                    card.classList.toggle('hidden', !matches);
                    if (matches) totalVisible++;
                });
            }

            // Hide category group headers if all items in category are hidden by search
            if (this.dom.categoryGroups) {
                this.dom.categoryGroups.forEach(group => {
                    const visibleInGroup = group.querySelectorAll('.feature-toggle-card:not(.hidden)');
                    group.classList.toggle('hidden', visibleInGroup.length === 0);
                });
            }

            if (this.dom.searchEmpty) {
                this.dom.searchEmpty.classList.toggle('hidden', totalVisible > 0);
            }
        },

        updateCountersAndChips() {
            // Count active features (excluding duplicate alias)
            const keys = Object.keys(DEFAULT_FEATURES).filter(k => k !== 'widget_sidebar_pet');
            const activeCount = keys.filter(k => this.config[k] !== false).length;
            const totalCount = keys.length;

            if (this.dom.activeCountBadge) {
                this.dom.activeCountBadge.textContent = `${activeCount}/${totalCount} Module Đang Bật`;
                this.dom.activeCountBadge.classList.toggle('partial', activeCount < totalCount);
            }

            // Category counters & bulk button labels
            Object.keys(FEATURE_CATEGORIES).forEach(cat => {
                const list = FEATURE_CATEGORIES[cat];
                const activeInCat = list.filter(k => this.config[k] !== false).length;
                const totalInCat = list.length;

                const counterEl = document.querySelector(`.mcc-cat-counter[data-cat="${cat}"]`);
                if (counterEl) {
                    counterEl.textContent = `${activeInCat}/${totalInCat} Bật`;
                }

                const toggleBtn = document.querySelector(`.mcc-cat-toggle-btn[data-cat="${cat}"]`);
                if (toggleBtn) {
                    toggleBtn.textContent = (activeInCat === totalInCat) ? 'Tắt Cả Nhóm' : 'Bật Cả Nhóm';
                }
            });

            // Toggle Card status chips & card classes
            if (this.dom.cards) {
                this.dom.cards.forEach(card => {
                    const featKey = card.getAttribute('data-feature-card');
                    if (featKey) {
                        const isEnabled = this.config[featKey] !== false;
                        card.classList.toggle('feature-disabled', !isEnabled);

                        const chip = card.querySelector(`[data-status-for="${featKey}"]`);
                        if (chip) {
                            chip.textContent = isEnabled ? 'BẬT' : 'ĐÃ TẮT';
                            chip.classList.toggle('disabled', !isEnabled);
                        }
                    }
                });
            }
        },

        syncCheckboxUI() {
            if (!this.dom.checkboxes) return;
            this.dom.checkboxes.forEach(cb => {
                const featKey = cb.getAttribute('data-feature');
                if (featKey && this.config[featKey] !== undefined) {
                    cb.checked = (this.config[featKey] !== false);
                }
            });
        },

        updatePresetButtonsState() {
            const keys = Object.keys(DEFAULT_FEATURES).filter(k => k !== 'widget_sidebar_pet');
            const isAll = keys.every(k => this.config[k] !== false);
            if (this.dom.btnPresetAll) this.dom.btnPresetAll.classList.toggle('active', isAll);
            if (this.dom.btnPresetMinimal) this.dom.btnPresetMinimal.classList.remove('active');
            if (this.dom.btnPresetDev) this.dom.btnPresetDev.classList.remove('active');
        },

        applyConfig(isInitial = false) {
            this.applyDOMState();

            // Run initial teardown for any disabled feature if initial load
            if (isInitial) {
                Object.keys(DEFAULT_FEATURES).forEach(k => {
                    if (this.config[k] === false) {
                        this.onFeatureDisabled(k);
                    }
                });
            }
        },

        applyDOMState() {
            // 1. Sidebar Navigation Items
            if (elements.navItemOverview) elements.navItemOverview.classList.toggle('hidden', this.config.tab_overview === false);
            if (elements.navItemDisk) elements.navItemDisk.classList.toggle('hidden', this.config.tab_disk === false);
            if (elements.navItemApps) elements.navItemApps.classList.toggle('hidden', this.config.tab_apps === false);
            if (elements.navItemDownloads) elements.navItemDownloads.classList.toggle('hidden', this.config.tab_downloads === false);
            if (elements.navItemNotif) elements.navItemNotif.classList.toggle('hidden', this.config.tab_notifications === false);
            if (elements.navItemAlerts) elements.navItemAlerts.classList.toggle('hidden', this.config.tab_alerts === false);
            if (elements.navItemFocus) elements.navItemFocus.classList.toggle('hidden', this.config.tab_focus === false);
            if (elements.navItemRadar) elements.navItemRadar.classList.toggle('hidden', this.config.tab_radar === false);
            if (elements.navItemPower) elements.navItemPower.classList.toggle('hidden', this.config.tab_power === false);
            if (elements.navItemWallpaper) elements.navItemWallpaper.classList.toggle('hidden', this.config.tab_wallpaper === false);
            if (elements.navItemLab) elements.navItemLab.classList.toggle('hidden', this.config.tab_lab === false);
            if (elements.navItemVocab) elements.navItemVocab.classList.toggle('hidden', this.config.tab_vocab === false);

            // 1.1 Auto-hide section groups if all tabs within them are disabled
            ['nav-group-system', 'nav-group-network', 'nav-group-tools'].forEach(groupId => {
                const groupEl = document.getElementById(groupId);
                if (groupEl) {
                    const visibleTabs = groupEl.querySelectorAll('.sidebar-nav-item:not(.hidden)');
                    groupEl.classList.toggle('hidden', visibleTabs.length === 0);
                }
            });

            // 2. AI Assistants
            if (this.dom.headerJarvisBtn) this.dom.headerJarvisBtn.classList.toggle('hidden', this.config.ai_jarvis_voice === false);
            if (this.dom.jarvisCapsule) this.dom.jarvisCapsule.classList.toggle('hidden', this.config.ai_jarvis_voice === false);
            if (this.dom.aiFlyoutWrapper) this.dom.aiFlyoutWrapper.classList.toggle('hidden', this.config.ai_gemini_chat === false);

            // 3. Widgets
            if (this.dom.sidebarQuickActions) this.dom.sidebarQuickActions.classList.toggle('hidden', this.config.widget_sidebar_actions === false);
            if (this.dom.sidebarWidgets) this.dom.sidebarWidgets.classList.toggle('hidden', this.config.widget_sidebar_mini === false);
            if (this.dom.sidebarCyberPet) {
                const showPet = (this.config.widget_cyber_pet !== false && this.config.widget_sidebar_pet !== false);
                this.dom.sidebarCyberPet.classList.toggle('hidden', !showPet);
            }
            if (this.dom.notifFlyoutWrapper) this.dom.notifFlyoutWrapper.classList.toggle('hidden', this.config.widget_header_notif_bell === false);
            if (this.dom.weatherFlyoutWrapper) this.dom.weatherFlyoutWrapper.classList.toggle('hidden', this.config.widget_weather === false);

            // 4. Tab Fallback (If current active tab was disabled, switch to first enabled tab)
            const tabKeyMap = {
                overview: 'tab_overview',
                disk: 'tab_disk',
                apps: 'tab_apps',
                downloads: 'tab_downloads',
                notifications: 'tab_notifications',
                alerts: 'tab_alerts',
                focus: 'tab_focus',
                radar: 'tab_radar',
                power: 'tab_power',
                wallpaper: 'tab_wallpaper',
                lab: 'tab_lab',
                vocab: 'tab_vocab',
            };

            const currentTabKey = tabKeyMap[state.activeTab];
            if (currentTabKey && this.config[currentTabKey] === false) {
                const tabsOrder = ['overview', 'disk', 'apps', 'power', 'downloads', 'radar', 'alerts', 'notifications', 'focus', 'lab', 'wallpaper', 'vocab'];
                const fallbackTab = tabsOrder.find(t => this.config[tabKeyMap[t]] !== false) || 'overview';
                switchTab(fallbackTab);
            }
        },

        getFeatureDisplayName(key) {
            const map = {
                tab_overview: 'Real-time Monitor',
                tab_disk: 'Disk Breakdown',
                tab_apps: 'App Analytics',
                tab_power: 'Power & Eco Cost',
                tab_downloads: 'Downloads Tracker',
                tab_radar: 'Network & LAN Radar',
                tab_alerts: 'Alerts & Webhooks',
                tab_notifications: 'Notifications Hub',
                tab_focus: 'Cyber Focus Deck',
                tab_lab: 'Prompt & Snippet Lab',
                tab_wallpaper: 'Wallpaper Studio',
                tab_vocab: 'Daily Vocab Booster',
                ai_jarvis_voice: 'Jarvis Voice AI Copilot',
                ai_gemini_chat: 'Google Gemini AI Copilot',
                widget_sidebar_actions: 'Sidebar Quick Actions',
                widget_sidebar_mini: 'Sidebar Mini Widgets',
                widget_header_notif_bell: 'Header Notification Bell',
                widget_cyber_pet: 'Cyber Tamagotchi Pet',
                widget_sidebar_pet: 'Cyber Tamagotchi Pet',
                widget_weather: 'Weather Header Widget',
                ambient_weather_effect: 'Ambient Atmospheric Canvas',
            };
            return map[key] || key;
        },

        getCategoryDisplayName(cat) {
            const map = {
                system: 'Hệ Thống & Phần Cứng',
                network: 'Mạng & Cảnh Báo',
                productivity: 'Tiện Ích & AI Studio',
                widgets: 'Trợ Lý AI & Tiện Ích Giao Diện',
            };
            return map[cat] || cat;
        }
    };

    // =========================================================================
    // IN-BROWSER MEDIA & DOCUMENT VIEWER MODULE (Image, Video, PDF, Audio, Text)
    // =========================================================================
    const mediaViewerManager = {
        state: {
            isOpen: false,
            currentPath: '',
            meta: null,
            zoom: 1.0,
            rotation: 0,
            panX: 0,
            panY: 0,
            isDragging: false,
            startX: 0,
            startY: 0,
        },
        dom: {},

        init() {
            this.cacheDOM();
            this.bindEvents();
        },

        cacheDOM() {
            this.dom = {
                modal: document.getElementById('media-viewer-modal'),
                typeBadge: document.getElementById('mv-type-badge'),
                fileTitle: document.getElementById('mv-file-title'),
                fileSubpath: document.getElementById('mv-file-subpath'),
                imageControls: document.getElementById('mv-image-controls'),
                videoControls: document.getElementById('mv-video-controls'),
                pdfControls: document.getElementById('mv-pdf-controls'),
                btnZoomOut: document.getElementById('mv-btn-zoom-out'),
                btnZoomReset: document.getElementById('mv-btn-zoom-reset'),
                zoomLevelText: document.getElementById('mv-zoom-level-text'),
                btnZoomIn: document.getElementById('mv-btn-zoom-in'),
                btnRotateLeft: document.getElementById('mv-btn-rotate-left'),
                btnRotateRight: document.getElementById('mv-btn-rotate-right'),
                videoSpeedSelect: document.getElementById('mv-video-speed-select'),
                btnVideoPip: document.getElementById('mv-btn-video-pip'),
                btnPdfNewtab: document.getElementById('mv-btn-pdf-newtab'),
                btnOpenExplorer: document.getElementById('mv-btn-open-explorer'),
                btnCopyPath: document.getElementById('mv-btn-copy-path'),
                btnDownload: document.getElementById('mv-btn-download'),
                btnFullscreen: document.getElementById('mv-btn-fullscreen'),
                btnClose: document.getElementById('mv-btn-close'),
                stageViewport: document.getElementById('mv-stage-viewport'),
                loadingOverlay: document.getElementById('mv-stage-loading'),
                loadingText: document.getElementById('mv-loading-text'),
                errorOverlay: document.getElementById('mv-stage-error'),
                errorTitle: document.getElementById('mv-error-title'),
                errorDesc: document.getElementById('mv-error-desc'),
                viewImage: document.getElementById('mv-view-image'),
                imageCanvasWrapper: document.getElementById('mv-image-canvas-wrapper'),
                imgElement: document.getElementById('mv-img-element'),
                viewVideo: document.getElementById('mv-view-video'),
                videoElement: document.getElementById('mv-video-element'),
                viewPdf: document.getElementById('mv-view-pdf'),
                pdfFrame: document.getElementById('mv-pdf-frame'),
                viewAudio: document.getElementById('mv-view-audio'),
                audioElement: document.getElementById('mv-audio-element'),
                audioTitle: document.getElementById('mv-audio-title'),
                viewText: document.getElementById('mv-view-text'),
                textContent: document.getElementById('mv-text-content'),
                metaSize: document.getElementById('mv-meta-size'),
                metaMime: document.getElementById('mv-meta-mime'),
                metaModified: document.getElementById('mv-meta-modified'),
                metaExtra: document.getElementById('mv-meta-extra'),
            };
        },

        bindEvents() {
            if (!this.dom.modal) return;

            // Close actions
            if (this.dom.btnClose) {
                this.dom.btnClose.addEventListener('click', () => this.close());
            }
            this.dom.modal.addEventListener('click', (e) => {
                if (e.target === this.dom.modal) this.close();
            });
            window.addEventListener('keydown', (e) => {
                if (!this.state.isOpen) return;
                if (e.key === 'Escape') {
                    this.close();
                } else if (e.key === '+' || e.key === '=') {
                    this.adjustZoom(0.2);
                } else if (e.key === '-') {
                    this.adjustZoom(-0.2);
                } else if (e.key === '0') {
                    this.resetImageTransform();
                } else if (e.key.toLowerCase() === 'r') {
                    this.rotateImage(90);
                }
            });

            // Zoom & Pan for Image
            if (this.dom.btnZoomIn) {
                this.dom.btnZoomIn.addEventListener('click', () => this.adjustZoom(0.25));
            }
            if (this.dom.btnZoomOut) {
                this.dom.btnZoomOut.addEventListener('click', () => this.adjustZoom(-0.25));
            }
            if (this.dom.btnZoomReset) {
                this.dom.btnZoomReset.addEventListener('click', () => this.resetImageTransform());
            }
            if (this.dom.btnRotateLeft) {
                this.dom.btnRotateLeft.addEventListener('click', () => this.rotateImage(-90));
            }
            if (this.dom.btnRotateRight) {
                this.dom.btnRotateRight.addEventListener('click', () => this.rotateImage(90));
            }

            // Mouse wheel zoom
            if (this.dom.imageCanvasWrapper) {
                this.dom.imageCanvasWrapper.addEventListener('wheel', (e) => {
                    e.preventDefault();
                    const delta = e.deltaY < 0 ? 0.15 : -0.15;
                    this.adjustZoom(delta);
                }, { passive: false });

                // Dragging Pan
                this.dom.imageCanvasWrapper.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    this.state.isDragging = true;
                    this.state.startX = e.clientX - this.state.panX;
                    this.state.startY = e.clientY - this.state.panY;
                    this.dom.imageCanvasWrapper.classList.add('grabbing');
                });

                window.addEventListener('mousemove', (e) => {
                    if (!this.state.isDragging) return;
                    this.state.panX = e.clientX - this.state.startX;
                    this.state.panY = e.clientY - this.state.startY;
                    this.updateImageTransform();
                });

                window.addEventListener('mouseup', () => {
                    if (this.state.isDragging) {
                        this.state.isDragging = false;
                        if (this.dom.imageCanvasWrapper) this.dom.imageCanvasWrapper.classList.remove('grabbing');
                    }
                });
            }

            // Video Controls
            if (this.dom.videoSpeedSelect) {
                this.dom.videoSpeedSelect.addEventListener('change', (e) => {
                    if (this.dom.videoElement) {
                        this.dom.videoElement.playbackRate = parseFloat(e.target.value) || 1.0;
                    }
                });
            }
            if (this.dom.btnVideoPip) {
                this.dom.btnVideoPip.addEventListener('click', async () => {
                    if (this.dom.videoElement && document.pictureInPictureEnabled) {
                        try {
                            if (document.pictureInPictureElement) {
                                await document.exitPictureInPicture();
                            } else {
                                await this.dom.videoElement.requestPictureInPicture();
                            }
                        } catch (err) {
                            console.warn('PiP error:', err);
                        }
                    }
                });
            }

            // PDF in new tab
            if (this.dom.btnPdfNewtab) {
                this.dom.btnPdfNewtab.addEventListener('click', () => {
                    if (this.state.currentPath) {
                        window.open(`/api/media/preview?path=${encodeURIComponent(this.state.currentPath)}`, '_blank');
                    }
                });
            }

            // Universal Toolbar Actions
            if (this.dom.btnOpenExplorer) {
                this.dom.btnOpenExplorer.addEventListener('click', () => {
                    if (this.state.currentPath) {
                        openFileInExplorer(this.state.currentPath);
                    }
                });
            }

            if (this.dom.btnCopyPath) {
                this.dom.btnCopyPath.addEventListener('click', async () => {
                    if (this.state.currentPath) {
                        try {
                            await navigator.clipboard.writeText(this.state.currentPath);
                            showActionToast('📋 Đã sao chép đường dẫn file!');
                        } catch (e) {
                            showActionToast('Lỗi khi sao chép đường dẫn');
                        }
                    }
                });
            }

            if (this.dom.btnDownload) {
                this.dom.btnDownload.addEventListener('click', () => {
                    if (this.state.currentPath) {
                        const a = document.createElement('a');
                        a.href = `/api/media/preview?path=${encodeURIComponent(this.state.currentPath)}`;
                        a.download = this.state.meta ? this.state.meta.file_name : 'download';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }
                });
            }

            if (this.dom.btnFullscreen) {
                this.dom.btnFullscreen.addEventListener('click', () => {
                    if (!document.fullscreenElement) {
                        this.dom.modal.requestFullscreen().catch(err => console.warn(err));
                    } else {
                        document.exitFullscreen().catch(err => console.warn(err));
                    }
                });
            }
        },

        async open(filePath) {
            if (!filePath) return;
            this.state.isOpen = true;
            this.state.currentPath = filePath;
            this.resetImageTransform();

            if (this.dom.modal) {
                this.dom.modal.style.display = 'flex';
                this.dom.modal.setAttribute('aria-hidden', 'false');
            }

            this.showLoading(true);
            this.hideAllPanels();

            try {
                const res = await fetch(`/api/media/info?path=${encodeURIComponent(filePath)}`);
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: 'Không thể đọc tệp.' }));
                    this.showError('Không thể mở tệp', err.detail || 'Tệp không tồn tại hoặc bị từ chối truy cập.');
                    return;
                }

                const meta = await res.json();
                this.state.meta = meta;
                this.renderMetaHeader(meta);
                this.renderMedia(meta);
            } catch (err) {
                this.showError('Lỗi kết nối máy chủ', 'Không thể kết nối đến API Media Preview.');
            }
        },

        close() {
            this.state.isOpen = false;
            if (this.dom.modal) {
                this.dom.modal.style.display = 'none';
                this.dom.modal.setAttribute('aria-hidden', 'true');
            }

            // Stop media elements
            if (this.dom.videoElement) {
                this.dom.videoElement.pause();
                this.dom.videoElement.src = '';
                this.dom.videoElement.load();
            }
            if (this.dom.audioElement) {
                this.dom.audioElement.pause();
                this.dom.audioElement.src = '';
                this.dom.audioElement.load();
            }
            if (this.dom.pdfFrame) {
                this.dom.pdfFrame.src = 'about:blank';
            }
            if (this.dom.imgElement) {
                this.dom.imgElement.src = '';
            }

            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
        },

        showLoading(show, text = 'Đang tải tệp tin...') {
            if (this.dom.loadingOverlay) {
                this.dom.loadingOverlay.style.display = show ? 'flex' : 'none';
                if (this.dom.loadingText) this.dom.loadingText.textContent = text;
            }
        },

        showError(title, desc) {
            this.showLoading(false);
            this.hideAllPanels();
            if (this.dom.errorOverlay) {
                this.dom.errorOverlay.style.display = 'flex';
                if (this.dom.errorTitle) this.dom.errorTitle.textContent = title;
                if (this.dom.errorDesc) this.dom.errorDesc.textContent = desc;
            }
        },

        hideAllPanels() {
            if (this.dom.errorOverlay) this.dom.errorOverlay.style.display = 'none';
            if (this.dom.viewImage) this.dom.viewImage.style.display = 'none';
            if (this.dom.viewVideo) this.dom.viewVideo.style.display = 'none';
            if (this.dom.viewPdf) this.dom.viewPdf.style.display = 'none';
            if (this.dom.viewAudio) this.dom.viewAudio.style.display = 'none';
            if (this.dom.viewText) this.dom.viewText.style.display = 'none';
        },

        renderMetaHeader(meta) {
            if (this.dom.fileTitle) {
                this.dom.fileTitle.textContent = meta.file_name;
                this.dom.fileTitle.title = meta.file_path;
            }
            if (this.dom.fileSubpath) {
                this.dom.fileSubpath.textContent = meta.file_path;
                this.dom.fileSubpath.title = meta.file_path;
            }

            // Category Badge
            const badgeMap = {
                image: { text: '🖼️ HÌNH ẢNH', class: 'type-image' },
                video: { text: '🎬 VIDEO', class: 'type-video' },
                pdf: { text: '📄 TÀI LIỆU PDF', class: 'type-pdf' },
                audio: { text: '🎵 ÂM THANH', class: 'type-audio' },
                text: { text: '📝 VĂN BẢN / CODE', class: 'type-text' },
                unknown: { text: '📁 TỆP TIN', class: 'type-text' },
            };
            const b = badgeMap[meta.category] || badgeMap.unknown;
            if (this.dom.typeBadge) {
                this.dom.typeBadge.textContent = b.text;
                this.dom.typeBadge.className = `mv-type-badge ${b.class}`;
            }

            // Toolbar visibility toggles
            if (this.dom.imageControls) this.dom.imageControls.style.display = meta.category === 'image' ? 'flex' : 'none';
            if (this.dom.videoControls) this.dom.videoControls.style.display = meta.category === 'video' ? 'flex' : 'none';
            if (this.dom.pdfControls) this.dom.pdfControls.style.display = meta.category === 'pdf' ? 'flex' : 'none';

            // Footer info
            if (this.dom.metaSize) this.dom.metaSize.textContent = `Dung lượng: ${meta.size_formatted}`;
            if (this.dom.metaMime) this.dom.metaMime.textContent = `MIME: ${meta.mime_type}`;
            if (this.dom.metaModified) this.dom.metaModified.textContent = `Cập nhật: ${meta.modified_at}`;
        },

        renderMedia(meta) {
            this.showLoading(false);
            const streamUrl = `/api/media/preview?path=${encodeURIComponent(meta.file_path)}`;

            if (meta.category === 'image') {
                if (this.dom.viewImage && this.dom.imgElement) {
                    this.dom.viewImage.style.display = 'flex';
                    this.dom.imgElement.src = streamUrl;
                    this.resetImageTransform();
                    this.dom.imgElement.onload = () => {
                        if (this.dom.metaExtra) {
                            this.dom.metaExtra.style.display = 'inline-block';
                            this.dom.metaExtra.textContent = `Độ phân giải: ${this.dom.imgElement.naturalWidth} × ${this.dom.imgElement.naturalHeight} px`;
                        }
                    };
                }
            } else if (meta.category === 'video') {
                if (this.dom.viewVideo && this.dom.videoElement) {
                    this.dom.viewVideo.style.display = 'flex';
                    this.dom.videoElement.src = streamUrl;
                    this.dom.videoElement.playbackRate = parseFloat(this.dom.videoSpeedSelect?.value || '1.0');
                    this.dom.videoElement.play().catch(() => {});
                }
            } else if (meta.category === 'pdf') {
                if (this.dom.viewPdf && this.dom.pdfFrame) {
                    this.dom.viewPdf.style.display = 'flex';
                    this.dom.pdfFrame.src = streamUrl;
                }
            } else if (meta.category === 'audio') {
                if (this.dom.viewAudio && this.dom.audioElement) {
                    this.dom.viewAudio.style.display = 'flex';
                    if (this.dom.audioTitle) this.dom.audioTitle.textContent = meta.file_name;
                    this.dom.audioElement.src = streamUrl;
                    this.dom.audioElement.play().catch(() => {});
                }
            } else if (meta.category === 'text' || meta.text_content !== null) {
                if (this.dom.viewText && this.dom.textContent) {
                    this.dom.viewText.style.display = 'flex';
                    this.dom.textContent.textContent = meta.text_content || 'Nội dung tệp tin rỗng.';
                }
            } else {
                // Generic preview via iframe
                if (this.dom.viewPdf && this.dom.pdfFrame) {
                    this.dom.viewPdf.style.display = 'flex';
                    this.dom.pdfFrame.src = streamUrl;
                }
            }
        },

        adjustZoom(delta) {
            this.state.zoom = Math.max(0.2, Math.min(5.0, this.state.zoom + delta));
            this.updateImageTransform();
        },

        rotateImage(deg) {
            this.state.rotation = (this.state.rotation + deg) % 360;
            this.updateImageTransform();
        },

        resetImageTransform() {
            this.state.zoom = 1.0;
            this.state.rotation = 0;
            this.state.panX = 0;
            this.state.panY = 0;
            this.updateImageTransform();
        },

        updateImageTransform() {
            if (this.dom.imgElement) {
                this.dom.imgElement.style.transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom}) rotate(${this.state.rotation}deg)`;
            }
            if (this.dom.zoomLevelText) {
                this.dom.zoomLevelText.textContent = `${Math.round(this.state.zoom * 100)}%`;
            }
        }
    };

    // =========================================================================
    // TAB 12: DAILY ENGLISH & VOCAB BOOSTER MANAGER
    // =========================================================================
    const vocabManager = {
        state: {
            todayWords: [],
            currentCardIndex: 0,
            isFlipped: false,
            activeMode: 'flashcard', // 'flashcard', 'quiz', 'notebook'
            selectedVoiceLang: 'en-US',
            quiz: {
                questions: [],
                currentQIdx: 0,
                score: 0,
                totalQuestions: 4,
                timerSeconds: 30,
                timerInterval: null,
                isAnswered: false,
                startTime: null
            },
            notebook: {
                words: [],
                total: 0,
                search: '',
                category: 'all',
                status: 'all',
                searchTimeout: null
            },
            stats: {
                total_words: 0,
                learned_words: 0,
                streak_days: 1,
                total_reviews: 0
            },
            voices: []
        },

        dom: {},

        init() {
            this.cacheDOM();
            this.bindEvents();
            this.initSpeechVoices();
            this.initConfetti();
            this.loadStats();
            this.loadTodayWords();
            this.loadNotebook();
            window.vocabManager = this;
        },

        cacheDOM() {
            this.dom = {
                // View & Mode switchers
                view: document.getElementById('view-vocab-booster'),
                btnModeFlashcard: document.getElementById('btn-mode-flashcard'),
                btnModeQuiz: document.getElementById('btn-mode-quiz'),
                btnModeNotebook: document.getElementById('btn-mode-notebook'),
                modeFlashcard: document.getElementById('vocab-mode-flashcard'),
                modeQuiz: document.getElementById('vocab-mode-quiz'),
                modeNotebook: document.getElementById('vocab-mode-notebook'),

                // Header Top Actions
                btnTopAdd: document.getElementById('btn-vocab-top-add'),
                btnTopRefresh: document.getElementById('btn-vocab-top-refresh'),
                btnTopReset: document.getElementById('btn-vocab-top-reset'),

                // Badges & KPIs
                badgeFlashcardCount: document.getElementById('badge-flashcard-count'),
                badgeNotebookCount: document.getElementById('badge-notebook-count'),
                statTotalWords: document.getElementById('vocab-stat-total-words'),
                statLearnedCount: document.getElementById('vocab-stat-learned-count'),
                statLearnedBar: document.getElementById('vocab-stat-learned-bar'),
                statLearnedPct: document.getElementById('vocab-stat-learned-pct'),
                statStreakDays: document.getElementById('vocab-stat-streak-days'),
                statTotalReviews: document.getElementById('vocab-stat-total-reviews'),

                // Voice selector
                selectVoice: document.getElementById('vocab-select-voice'),

                // Flashcard Elements
                cardStepBadge: document.getElementById('vocab-card-step-badge'),
                cardCatBadge: document.getElementById('vocab-card-cat-badge'),
                cardPosBadge: document.getElementById('vocab-card-pos-badge'),
                cardStatusPill: document.getElementById('vocab-card-status-pill'),
                cardProgressFill: document.getElementById('vocab-flashcard-progress-fill'),
                card3D: document.getElementById('vocab-3d-card'),
                cardStage: document.getElementById('vocab-flashcard-stage'),
                confettiCanvas: document.getElementById('vocab-confetti-canvas'),

                // Flashcard Front
                frontWord: document.getElementById('vocab-front-word'),
                frontPhonetic: document.getElementById('vocab-front-phonetic'),
                frontExample: document.getElementById('vocab-front-example'),
                btnSoundFront: document.getElementById('btn-card-sound-front'),

                // Flashcard Back
                backMeaning: document.getElementById('vocab-back-meaning'),
                backExampleEn: document.getElementById('vocab-back-example-en'),
                backExampleVi: document.getElementById('vocab-back-example-vi'),
                btnSoundBack: document.getElementById('btn-card-sound-back'),

                // Flashcard Controls Toolbar
                btnPrev: document.getElementById('btn-vocab-prev'),
                btnReviewLater: document.getElementById('btn-vocab-review-later'),
                btnSpeak: document.getElementById('btn-vocab-speak'),
                btnFlip: document.getElementById('btn-vocab-flip'),
                btnMastered: document.getElementById('btn-vocab-mastered'),
                btnNext: document.getElementById('btn-vocab-next'),

                // Quiz Elements
                quizSecondsLeft: document.getElementById('quiz-seconds-left'),
                quizTimerFill: document.getElementById('quiz-timer-fill'),
                quizQnumBadge: document.getElementById('quiz-qnum-badge'),
                quizScoreBadge: document.getElementById('quiz-score-badge'),
                quizCardActive: document.getElementById('quiz-card-active'),
                quizQTypeBadge: document.getElementById('quiz-q-type-badge'),
                quizQCatBadge: document.getElementById('quiz-q-cat-badge'),
                quizQuestionText: document.getElementById('quiz-question-text'),
                quizOptionsGrid: document.getElementById('quiz-options-grid'),
                quizExplanationBox: document.getElementById('quiz-explanation-box'),
                quizExplanationContent: document.getElementById('quiz-explanation-content'),
                btnQuizNextQ: document.getElementById('btn-quiz-next-q'),

                // Quiz Result Elements
                quizCardResult: document.getElementById('quiz-card-result'),
                quizResultEmoji: document.getElementById('quiz-result-emoji'),
                quizResultTitle: document.getElementById('quiz-result-title'),
                quizResultSub: document.getElementById('quiz-result-sub'),
                quizFinalScore: document.getElementById('quiz-final-score'),
                quizBadgeRating: document.getElementById('quiz-badge-rating'),
                quizBadgeTime: document.getElementById('quiz-badge-time'),
                quizBadgeCorrect: document.getElementById('quiz-badge-correct'),
                btnQuizPlayAgain: document.getElementById('btn-quiz-play-again'),
                btnQuizBackFlashcard: document.getElementById('btn-quiz-back-flashcard'),

                // Custom Notebook Elements
                formQuickAdd: document.getElementById('vocab-quick-add-form'),
                inputWord: document.getElementById('input-vocab-word'),
                inputPhonetic: document.getElementById('input-vocab-phonetic'),
                selectPos: document.getElementById('select-vocab-pos'),
                inputMeaning: document.getElementById('input-vocab-meaning'),
                selectCat: document.getElementById('select-vocab-cat'),
                inputExEn: document.getElementById('input-vocab-ex-en'),
                inputExVi: document.getElementById('input-vocab-ex-vi'),
                btnClearForm: document.getElementById('btn-clear-vocab-form'),

                searchInput: document.getElementById('vocab-search-input'),
                btnClearSearch: document.getElementById('btn-clear-vocab-search'),
                filterCat: document.getElementById('vocab-filter-cat'),
                filterStatus: document.getElementById('vocab-filter-status'),
                tableCountBadge: document.getElementById('vocab-table-count-badge'),
                notebookTbody: document.getElementById('vocab-notebook-tbody'),

                // Edit Modal Elements
                editModal: document.getElementById('vocab-edit-modal'),
                btnCloseEdit: document.getElementById('btn-close-vocab-edit'),
                btnCancelEdit: document.getElementById('btn-cancel-vocab-edit'),
                editForm: document.getElementById('vocab-edit-form'),
                editId: document.getElementById('edit-vocab-id'),
                editWord: document.getElementById('edit-vocab-word'),
                editPhonetic: document.getElementById('edit-vocab-phonetic'),
                editPos: document.getElementById('edit-vocab-pos'),
                editCat: document.getElementById('edit-vocab-cat'),
                editMeaning: document.getElementById('edit-vocab-meaning'),
                editExEn: document.getElementById('edit-vocab-ex-en'),
                editExVi: document.getElementById('edit-vocab-ex-vi')
            };
        },

        bindEvents() {
            // Mode navigation
            if (this.dom.btnModeFlashcard) this.dom.btnModeFlashcard.addEventListener('click', () => this.switchMode('flashcard'));
            if (this.dom.btnModeQuiz) this.dom.btnModeQuiz.addEventListener('click', () => this.switchMode('quiz'));
            if (this.dom.btnModeNotebook) this.dom.btnModeNotebook.addEventListener('click', () => this.switchMode('notebook'));

            // Top Banner Action Buttons
            if (this.dom.btnTopAdd) {
                this.dom.btnTopAdd.addEventListener('click', () => {
                    this.switchMode('notebook');
                    setTimeout(() => {
                        if (this.dom.inputWord) {
                            this.dom.inputWord.focus();
                            this.dom.inputWord.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 100);
                });
            }

            if (this.dom.btnTopRefresh) {
                this.dom.btnTopRefresh.addEventListener('click', () => {
                    this.loadTodayWords(true);
                    showActionToast('🔄 Đã làm mới 5 từ vựng hôm nay!');
                });
            }

            if (this.dom.btnTopReset) {
                this.dom.btnTopReset.addEventListener('click', () => this.confirmResetSeeds());
            }

            // Voice selector change
            if (this.dom.selectVoice) {
                this.dom.selectVoice.addEventListener('change', (e) => {
                    this.state.selectedVoiceLang = e.target.value;
                });
            }

            // Flashcard 3D flip triggers
            if (this.dom.card3D) {
                this.dom.card3D.addEventListener('click', (e) => {
                    // Avoid flipping if clicking the sound button
                    if (e.target.closest('.card-sound-circle-btn')) return;
                    this.flipCard();
                });
            }

            if (this.dom.btnFlip) this.dom.btnFlip.addEventListener('click', () => this.flipCard());
            if (this.dom.btnPrev) this.dom.btnPrev.addEventListener('click', () => this.prevCard());
            if (this.dom.btnNext) this.dom.btnNext.addEventListener('click', () => this.nextCard());
            if (this.dom.btnReviewLater) this.dom.btnReviewLater.addEventListener('click', () => this.reviewLaterCurrent());
            if (this.dom.btnMastered) this.dom.btnMastered.addEventListener('click', () => this.toggleMasteredCurrent());

            // Flashcard sound buttons
            if (this.dom.btnSoundFront) this.dom.btnSoundFront.addEventListener('click', (e) => {
                e.stopPropagation();
                this.speakCurrentWord();
            });
            if (this.dom.btnSoundBack) this.dom.btnSoundBack.addEventListener('click', (e) => {
                e.stopPropagation();
                this.speakCurrentWord();
            });
            if (this.dom.btnSpeak) this.dom.btnSpeak.addEventListener('click', () => this.speakCurrentWord());

            // Keyboard navigation
            window.addEventListener('keydown', (e) => this.handleKeyDown(e));

            // Quiz controls
            if (this.dom.btnQuizNextQ) this.dom.btnQuizNextQ.addEventListener('click', () => this.nextQuizQuestion());
            if (this.dom.btnQuizPlayAgain) this.dom.btnQuizPlayAgain.addEventListener('click', () => this.startQuiz());
            if (this.dom.btnQuizBackFlashcard) this.dom.btnQuizBackFlashcard.addEventListener('click', () => this.switchMode('flashcard'));

            // Custom Notebook quick add form
            if (this.dom.formQuickAdd) {
                this.dom.formQuickAdd.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleQuickAddForm();
                });
            }

            if (this.dom.btnClearForm) {
                this.dom.btnClearForm.addEventListener('click', () => {
                    if (this.dom.formQuickAdd) this.dom.formQuickAdd.reset();
                });
            }

            // Notebook search & filters
            if (this.dom.searchInput) {
                this.dom.searchInput.addEventListener('input', (e) => {
                    const query = e.target.value;
                    if (this.dom.btnClearSearch) {
                        this.dom.btnClearSearch.classList.toggle('hidden', !query);
                    }
                    clearTimeout(this.state.notebook.searchTimeout);
                    this.state.notebook.searchTimeout = setTimeout(() => {
                        this.state.notebook.search = query.trim();
                        this.loadNotebook();
                    }, 250);
                });
            }

            if (this.dom.btnClearSearch) {
                this.dom.btnClearSearch.addEventListener('click', () => {
                    if (this.dom.searchInput) {
                        this.dom.searchInput.value = '';
                        this.dom.btnClearSearch.classList.add('hidden');
                        this.state.notebook.search = '';
                        this.loadNotebook();
                    }
                });
            }

            if (this.dom.filterCat) {
                this.dom.filterCat.addEventListener('change', (e) => {
                    this.state.notebook.category = e.target.value;
                    this.loadNotebook();
                });
            }

            if (this.dom.filterStatus) {
                this.dom.filterStatus.addEventListener('change', (e) => {
                    this.state.notebook.status = e.target.value;
                    this.loadNotebook();
                });
            }

            // Edit Modal bindings
            if (this.dom.btnCloseEdit) this.dom.btnCloseEdit.addEventListener('click', () => this.closeEditModal());
            if (this.dom.btnCancelEdit) this.dom.btnCancelEdit.addEventListener('click', () => this.closeEditModal());
            if (this.dom.editForm) {
                this.dom.editForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleEditFormSubmit();
                });
            }
        },

        onTabActivated() {
            this.loadStats();
            if (this.state.todayWords.length === 0) {
                this.loadTodayWords();
            }
            if (this.state.activeMode === 'quiz' && this.state.quiz.questions.length === 0) {
                this.startQuiz();
            }
        },

        switchMode(mode) {
            this.state.activeMode = mode;

            // Update mode buttons
            if (this.dom.btnModeFlashcard) this.dom.btnModeFlashcard.classList.toggle('active', mode === 'flashcard');
            if (this.dom.btnModeQuiz) this.dom.btnModeQuiz.classList.toggle('active', mode === 'quiz');
            if (this.dom.btnModeNotebook) this.dom.btnModeNotebook.classList.toggle('active', mode === 'notebook');

            // Update mode view containers
            if (this.dom.modeFlashcard) this.dom.modeFlashcard.classList.toggle('hidden', mode !== 'flashcard');
            if (this.dom.modeQuiz) this.dom.modeQuiz.classList.toggle('hidden', mode !== 'quiz');
            if (this.dom.modeNotebook) this.dom.modeNotebook.classList.toggle('hidden', mode !== 'notebook');

            if (mode === 'quiz') {
                this.startQuiz();
            } else if (mode === 'notebook') {
                this.loadNotebook();
            } else if (mode === 'flashcard') {
                this.renderCurrentCard();
            }
        },

        // =====================================================================
        // WEB SPEECH API INTEGRATION
        // =====================================================================
        initSpeechVoices() {
            if (!('speechSynthesis' in window)) return;
            const updateVoices = () => {
                const voices = window.speechSynthesis.getVoices();
                if (voices && voices.length > 0) {
                    this.state.voices = voices;
                }
            };
            updateVoices();
            if (window.speechSynthesis.onvoiceschanged !== undefined) {
                window.speechSynthesis.onvoiceschanged = updateVoices;
            }
        },

        speak(text, preferredLang = null) {
            if (!('speechSynthesis' in window) || !text) return;
            window.speechSynthesis.cancel(); // Stop ongoing speech

            const lang = preferredLang || this.state.selectedVoiceLang || 'en-US';
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = lang;
            utterance.rate = 0.92; // Natural clear pacing
            utterance.pitch = 1.0;

            // Match available voice
            if (this.state.voices.length > 0) {
                const voice = this.state.voices.find(v => v.lang.startsWith(lang.split('-')[0]) && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('David') || v.name.includes('Zira') || v.name.includes('English')));
                if (voice) utterance.voice = voice;
            }

            // Animate sound wave indicators
            const btnFront = this.dom.btnSoundFront;
            if (btnFront) btnFront.classList.add('speaking');

            utterance.onend = () => {
                if (btnFront) btnFront.classList.remove('speaking');
            };
            utterance.onerror = () => {
                if (btnFront) btnFront.classList.remove('speaking');
            };

            window.speechSynthesis.speak(utterance);
        },

        speakCurrentWord() {
            const current = this.state.todayWords[this.state.currentCardIndex];
            if (current) {
                this.speak(current.word, this.state.selectedVoiceLang);
            }
        },

        // =====================================================================
        // 3D FLASHCARD CONTROLLER
        // =====================================================================
        async loadTodayWords(forceRefresh = false) {
            try {
                const url = forceRefresh ? '/api/vocab/today?refresh=true' : '/api/vocab/today';
                const res = await fetch(url);
                const data = await res.json();
                if (data && data.success && Array.isArray(data.items)) {
                    this.state.todayWords = data.items;
                    this.state.currentCardIndex = 0;
                    this.state.isFlipped = false;
                    if (this.dom.badgeFlashcardCount) {
                        this.dom.badgeFlashcardCount.textContent = `${this.state.todayWords.length} Từ`;
                    }
                    this.renderCurrentCard();
                }
            } catch (err) {
                console.error('[VocabManager] Error loading today words:', err);
            }
        },

        renderCurrentCard() {
            const words = this.state.todayWords;
            if (!words || words.length === 0) {
                if (this.dom.frontWord) this.dom.frontWord.textContent = 'Đang tải...';
                return;
            }

            const idx = this.state.currentCardIndex;
            const item = words[idx];
            if (!item) return;

            // Reset card flip to front
            this.state.isFlipped = false;
            if (this.dom.card3D) this.dom.card3D.classList.remove('flipped');

            // Header tags & progress
            if (this.dom.cardStepBadge) this.dom.cardStepBadge.textContent = `Từ ${idx + 1} / ${words.length}`;
            if (this.dom.cardCatBadge) this.dom.cardCatBadge.textContent = item.category || 'General';
            if (this.dom.cardPosBadge) this.dom.cardPosBadge.textContent = item.part_of_speech || 'Word';
            
            if (this.dom.cardStatusPill) {
                this.dom.cardStatusPill.className = `vocab-status-pill ${item.learned ? 'learned' : 'unlearned'}`;
                this.dom.cardStatusPill.textContent = item.learned ? '✅ Đã thuộc' : '⏳ Chưa thuộc';
            }

            if (this.dom.cardProgressFill) {
                const pct = Math.round(((idx + 1) / words.length) * 100);
                this.dom.cardProgressFill.style.width = `${pct}%`;
            }

            // Front face
            if (this.dom.frontWord) this.dom.frontWord.textContent = item.word;
            if (this.dom.frontPhonetic) this.dom.frontPhonetic.textContent = item.phonetic || '';
            if (this.dom.frontExample) this.dom.frontExample.textContent = item.example_en ? `"${item.example_en}"` : '';

            // Back face
            if (this.dom.backMeaning) this.dom.backMeaning.textContent = item.meaning_vi;
            if (this.dom.backExampleEn) this.dom.backExampleEn.textContent = item.example_en ? `"${item.example_en}"` : '';
            if (this.dom.backExampleVi) this.dom.backExampleVi.textContent = item.example_vi ? `"${item.example_vi}"` : '';

            // Mastered button text
            if (this.dom.btnMastered) {
                this.dom.btnMastered.innerHTML = item.learned ? '<span>🌟 Đã Thuộc (Bỏ chọn)</span>' : '<span>✅ Đã thuộc (Mastered)</span>';
            }
        },

        flipCard() {
            this.state.isFlipped = !this.state.isFlipped;
            if (this.dom.card3D) {
                this.dom.card3D.classList.toggle('flipped', this.state.isFlipped);
            }
        },

        prevCard() {
            if (this.state.todayWords.length <= 1) return;
            this.state.currentCardIndex = (this.state.currentCardIndex - 1 + this.state.todayWords.length) % this.state.todayWords.length;
            this.renderCurrentCard();
        },

        nextCard() {
            if (this.state.todayWords.length <= 1) return;
            this.state.currentCardIndex = (this.state.currentCardIndex + 1) % this.state.todayWords.length;
            this.renderCurrentCard();
        },

        async reviewLaterCurrent() {
            const current = this.state.todayWords[this.state.currentCardIndex];
            if (current) {
                try {
                    await fetch(`/api/vocab/${current.id}/review`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ success: false })
                    });
                } catch (e) {
                    console.error(e);
                }
            }
            this.nextCard();
        },

        async toggleMasteredCurrent() {
            const current = this.state.todayWords[this.state.currentCardIndex];
            if (!current) return;

            try {
                const res = await fetch(`/api/vocab/${current.id}/toggle-learned`, { method: 'PATCH' });
                const data = await res.json();
                if (data && data.success) {
                    current.learned = data.learned;
                    if (current.learned) {
                        this.burstConfetti();
                        showActionToast(`🎉 Tuyệt vời! Bạn đã thuộc từ: "${current.word}"`);
                    } else {
                        showActionToast(`Đã chuyển từ "${current.word}" về danh sách cần ôn.`);
                    }
                    this.renderCurrentCard();
                    this.loadStats();
                    this.loadNotebook();
                }
            } catch (err) {
                console.error('[VocabManager] Toggle learned error:', err);
            }
        },

        handleKeyDown(e) {
            // Only capture shortcuts when Vocab tab is active and modal is not open
            if (state.activeTab !== 'vocab') return;
            if (this.dom.editModal && !this.dom.editModal.classList.contains('hidden')) return;

            // Ignore when typing inside input / textarea
            const tag = e.target.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if (this.state.activeMode === 'flashcard') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault();
                    this.flipCard();
                } else if (e.code === 'ArrowLeft') {
                    e.preventDefault();
                    this.prevCard();
                } else if (e.code === 'ArrowRight') {
                    e.preventDefault();
                    this.nextCard();
                } else if (e.code === 'KeyP') {
                    e.preventDefault();
                    this.speakCurrentWord();
                } else if (e.code === 'KeyM') {
                    e.preventDefault();
                    this.toggleMasteredCurrent();
                }
            }
        },

        // =====================================================================
        // CONFETTI PARTICLE BURST ENGINE
        // =====================================================================
        initConfetti() {
            const canvas = this.dom.confettiCanvas;
            if (!canvas) return;
            this.confettiCtx = canvas.getContext('2d');
            this.confettiParticles = [];
        },

        burstConfetti() {
            const canvas = this.dom.confettiCanvas;
            if (!canvas || !this.confettiCtx) return;

            canvas.width = canvas.parentElement.offsetWidth || 720;
            canvas.height = canvas.parentElement.offsetHeight || 380;

            const colors = ['#bcf846', '#38bdf8', '#fbbf24', '#f43f5e', '#a855f7', '#34d399'];
            this.confettiParticles = [];

            for (let i = 0; i < 65; i++) {
                this.confettiParticles.push({
                    x: canvas.width / 2,
                    y: canvas.height / 2,
                    vx: (Math.random() - 0.5) * 14,
                    vy: (Math.random() - 0.8) * 14,
                    size: Math.random() * 7 + 4,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    alpha: 1,
                    rotation: Math.random() * 360,
                    vr: (Math.random() - 0.5) * 12,
                    shape: Math.random() > 0.4 ? 'star' : 'rect'
                });
            }

            if (this.confettiAnimId) cancelAnimationFrame(this.confettiAnimId);
            const startTime = performance.now();

            const render = (time) => {
                const elapsed = time - startTime;
                this.confettiCtx.clearRect(0, 0, canvas.width, canvas.height);

                let alive = false;
                for (const p of this.confettiParticles) {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vy += 0.3; // Gravity
                    p.vx *= 0.98;
                    p.rotation += p.vr;
                    p.alpha = Math.max(0, 1 - elapsed / 1400);

                    if (p.alpha > 0) {
                        alive = true;
                        this.confettiCtx.save();
                        this.confettiCtx.globalAlpha = p.alpha;
                        this.confettiCtx.fillStyle = p.color;
                        this.confettiCtx.translate(p.x, p.y);
                        this.confettiCtx.rotate((p.rotation * Math.PI) / 180);

                        if (p.shape === 'star') {
                            // Draw 4-point glowing star
                            this.confettiCtx.beginPath();
                            this.confettiCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
                            this.confettiCtx.fill();
                        } else {
                            this.confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
                        }
                        this.confettiCtx.restore();
                    }
                }

                if (alive && elapsed < 1500) {
                    this.confettiAnimId = requestAnimationFrame(render);
                } else {
                    this.confettiCtx.clearRect(0, 0, canvas.width, canvas.height);
                }
            };

            this.confettiAnimId = requestAnimationFrame(render);
        },

        // =====================================================================
        // MINI QUIZ 30S ENGINE
        // =====================================================================
        async startQuiz() {
            if (this.dom.quizCardActive) this.dom.quizCardActive.classList.remove('hidden');
            if (this.dom.quizCardResult) this.dom.quizCardResult.classList.add('hidden');

            try {
                const res = await fetch('/api/vocab/quiz?count=4');
                const data = await res.json();
                if (data && data.success && Array.isArray(data.questions) && data.questions.length > 0) {
                    this.state.quiz.questions = data.questions;
                    this.state.quiz.currentQIdx = 0;
                    this.state.quiz.score = 0;
                    this.state.quiz.isAnswered = false;
                    this.state.quiz.timerSeconds = 30;
                    this.state.quiz.startTime = Date.now();

                    this.renderQuizQuestion();
                    this.startQuizTimer();
                } else {
                    if (this.dom.quizQuestionText) this.dom.quizQuestionText.textContent = 'Chưa có đủ từ vựng để tạo bài Quiz. Vui lòng thêm từ mới!';
                }
            } catch (err) {
                console.error('[VocabManager] Error starting quiz:', err);
            }
        },

        startQuizTimer() {
            if (this.state.quiz.timerInterval) clearInterval(this.state.quiz.timerInterval);

            const duration = 30; // 30 seconds
            const startTime = Date.now();

            this.state.quiz.timerInterval = setInterval(() => {
                const elapsed = (Date.now() - startTime) / 1000;
                const remaining = Math.max(0, duration - elapsed);
                this.state.quiz.timerSeconds = remaining;

                if (this.dom.quizSecondsLeft) {
                    this.dom.quizSecondsLeft.textContent = `${Math.ceil(remaining)}s`;
                }

                if (this.dom.quizTimerFill) {
                    const pct = (remaining / duration) * 100;
                    this.dom.quizTimerFill.style.width = `${pct}%`;
                }

                if (remaining <= 0) {
                    clearInterval(this.state.quiz.timerInterval);
                    this.finishQuiz();
                }
            }, 100);
        },

        renderQuizQuestion() {
            const q = this.state.quiz.questions[this.state.quiz.currentQIdx];
            if (!q) return;

            this.state.quiz.isAnswered = false;

            if (this.dom.quizQnumBadge) {
                this.dom.quizQnumBadge.textContent = `Câu ${this.state.quiz.currentQIdx + 1} / ${this.state.quiz.questions.length}`;
            }
            if (this.dom.quizScoreBadge) {
                this.dom.quizScoreBadge.textContent = `🏆 Score: ${this.state.quiz.score} pts`;
            }

            if (this.dom.quizQTypeBadge) {
                this.dom.quizQTypeBadge.textContent = q.type === 'fill_blank' ? 'ĐIỀN TỪ VÀO CHỖ TRỐNG' : 'TRẮC NGHIỆM NGHĨA TỪ';
            }
            if (this.dom.quizQCatBadge) {
                this.dom.quizQCatBadge.textContent = q.category || 'Tech & Networking';
            }
            if (this.dom.quizQuestionText) {
                this.dom.quizQuestionText.innerHTML = q.question;
            }

            // Render options
            if (this.dom.quizOptionsGrid) {
                const keys = ['A', 'B', 'C', 'D'];
                this.dom.quizOptionsGrid.innerHTML = q.options.map((opt, i) => `
                    <button class="quiz-opt-btn" data-opt-idx="${i}">
                        <span class="quiz-opt-key">${keys[i]}</span>
                        <span class="quiz-opt-text">${escapeHtml(opt)}</span>
                    </button>
                `).join('');

                this.dom.quizOptionsGrid.querySelectorAll('.quiz-opt-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const idx = parseInt(btn.getAttribute('data-opt-idx'), 10);
                        this.handleQuizAnswer(idx, btn);
                    });
                });
            }

            if (this.dom.quizExplanationBox) {
                this.dom.quizExplanationBox.classList.add('hidden');
            }
        },

        async handleQuizAnswer(selectedIdx, btnElement) {
            if (this.state.quiz.isAnswered) return;
            this.state.quiz.isAnswered = true;

            const q = this.state.quiz.questions[this.state.quiz.currentQIdx];
            if (!q) return;

            const isCorrect = (selectedIdx === q.correct_index);
            const optionBtns = this.dom.quizOptionsGrid.querySelectorAll('.quiz-opt-btn');

            // Disable all buttons
            optionBtns.forEach(b => b.disabled = true);

            if (isCorrect) {
                btnElement.classList.add('correct');
                this.state.quiz.score += 10;
                if (this.dom.quizScoreBadge) {
                    this.dom.quizScoreBadge.textContent = `🏆 Score: ${this.state.quiz.score} pts (+10!)`;
                }
            } else {
                btnElement.classList.add('wrong');
                // Highlight correct option
                if (optionBtns[q.correct_index]) {
                    optionBtns[q.correct_index].classList.add('correct');
                }
            }

            // Record review in backend
            try {
                fetch(`/api/vocab/${q.vocab_id}/review`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ success: isCorrect })
                });
            } catch (e) {}

            // Show explanation box
            if (this.dom.quizExplanationBox && this.dom.quizExplanationContent) {
                this.dom.quizExplanationContent.innerHTML = isCorrect 
                    ? `🎯 <b>Chính xác!</b> ${escapeHtml(q.explanation)}` 
                    : `❌ <b>Chưa đúng!</b> Đáp án đúng là: <b>${escapeHtml(q.options[q.correct_index])}</b>. ${escapeHtml(q.explanation)}`;
                this.dom.quizExplanationBox.classList.remove('hidden');
            }
        },

        nextQuizQuestion() {
            this.state.quiz.currentQIdx++;
            if (this.state.quiz.currentQIdx < this.state.quiz.questions.length) {
                this.renderQuizQuestion();
            } else {
                this.finishQuiz();
            }
        },

        finishQuiz() {
            if (this.state.quiz.timerInterval) {
                clearInterval(this.state.quiz.timerInterval);
                this.state.quiz.timerInterval = null;
            }

            if (this.dom.quizCardActive) this.dom.quizCardActive.classList.add('hidden');
            if (this.dom.quizCardResult) this.dom.quizCardResult.classList.remove('hidden');

            const score = this.state.quiz.score;
            const maxScore = this.state.quiz.questions.length * 10;
            const elapsed = Math.min(30, Math.round((Date.now() - (this.state.quiz.startTime || Date.now())) / 1000));

            if (this.dom.quizFinalScore) this.dom.quizFinalScore.textContent = score;

            let emoji = '🏆';
            let rating = '🌟 Đạt Chuẩn Pro';
            let title = 'Tuyệt Vời!';

            if (score === maxScore) {
                emoji = '👑';
                rating = '🔥 Điểm Số Tuyệt Đối!';
                title = 'Xuất Sắc! Master Từ Vựng!';
                this.burstConfetti();
            } else if (score >= 20) {
                emoji = '🎯';
                rating = '👍 Khá Tốt';
                title = 'Làm Rất Tốt!';
            } else {
                emoji = '⚡';
                rating = '📚 Cần Ôn Luyện Thêm';
                title = 'Cố Gắng Lên Nhé!';
            }

            if (this.dom.quizResultEmoji) this.dom.quizResultEmoji.textContent = emoji;
            if (this.dom.quizResultTitle) this.dom.quizResultTitle.textContent = title;
            if (this.dom.quizBadgeRating) this.dom.quizBadgeRating.textContent = rating;
            if (this.dom.quizBadgeTime) this.dom.quizBadgeTime.textContent = `⏱️ Thời gian: ${elapsed}s`;
            if (this.dom.quizBadgeCorrect) this.dom.quizBadgeCorrect.textContent = `🎯 Đúng: ${score / 10}/${this.state.quiz.questions.length} câu`;

            this.loadStats();
        },

        // =====================================================================
        // CUSTOM VOCAB NOTEBOOK & LIBRARY CONTROLLER
        // =====================================================================
        async loadNotebook() {
            try {
                const params = new URLSearchParams({
                    limit: '200',
                    offset: '0'
                });
                if (this.state.notebook.search) params.append('search', this.state.notebook.search);
                if (this.state.notebook.category && this.state.notebook.category !== 'all') params.append('category', this.state.notebook.category);
                if (this.state.notebook.status && this.state.notebook.status !== 'all') params.append('status', this.state.notebook.status);

                const res = await fetch(`/api/vocab/all?${params.toString()}`);
                const data = await res.json();

                if (data && data.success) {
                    this.state.notebook.words = data.items || [];
                    this.state.notebook.total = data.total || 0;

                    if (this.dom.tableCountBadge) {
                        this.dom.tableCountBadge.textContent = `${data.total} Từ vựng`;
                    }
                    if (this.dom.badgeNotebookCount) {
                        this.dom.badgeNotebookCount.textContent = `${data.total} Từ`;
                    }

                    this.renderNotebookTable();
                }
            } catch (err) {
                console.error('[VocabManager] Load notebook error:', err);
            }
        },

        renderNotebookTable() {
            const tbody = this.dom.notebookTbody;
            if (!tbody) return;

            const items = this.state.notebook.words;
            if (items.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" style="text-align:center; padding:30px; color:var(--text-muted);">
                            📭 Không tìm thấy từ vựng nào phù hợp với bộ lọc.
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = items.map((item, i) => `
                <tr data-vocab-id="${item.id}">
                    <td style="color:var(--text-muted); font-family:var(--font-mono); font-size:0.75rem;">${i + 1}</td>
                    <td>
                        <div class="word-cell-wrap">
                            <button class="btn-table-speech" data-word="${escapeHtml(item.word)}" title="Nghe phát âm">🔊</button>
                            <div>
                                <div class="table-word-title">${escapeHtml(item.word)}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="table-phonetic-text">${escapeHtml(item.phonetic || '')}</span>
                    </td>
                    <td>
                        <span style="font-size:0.75rem; color:var(--text-muted); font-style:italic;">${escapeHtml(item.part_of_speech || '')}</span>
                    </td>
                    <td>
                        <div class="table-meaning-text">${escapeHtml(item.meaning_vi)}</div>
                        ${item.example_en ? `<div class="table-ex-text">🇬🇧 "${escapeHtml(item.example_en)}"</div>` : ''}
                    </td>
                    <td>
                        <span class="table-cat-badge">${escapeHtml(item.category || 'General')}</span>
                    </td>
                    <td style="text-align:center;">
                        <button class="table-toggle-learned-btn ${item.learned ? 'learned' : 'unlearned'}" data-id="${item.id}" title="Nhấp để đổi trạng thái">
                            ${item.learned ? '✅ Đã thuộc' : '⏳ Cần ôn'}
                        </button>
                    </td>
                    <td style="text-align:center; font-family:var(--font-mono); font-size:0.75rem; color:var(--text-muted);">
                        ${item.review_count || 0}
                    </td>
                    <td style="text-align:right;">
                        <div class="table-actions-group">
                            <button class="btn-table-action edit-btn" data-id="${item.id}" title="Sửa từ vựng">✏️</button>
                            <button class="btn-table-action delete-btn" data-id="${item.id}" data-word="${escapeHtml(item.word)}" title="Xóa từ vựng">🗑️</button>
                        </div>
                    </td>
                </tr>
            `).join('');

            // Bind table row buttons
            tbody.querySelectorAll('.btn-table-speech').forEach(btn => {
                btn.addEventListener('click', () => {
                    const word = btn.getAttribute('data-word');
                    this.speak(word);
                });
            });

            tbody.querySelectorAll('.table-toggle-learned-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    this.toggleLearnedRow(id);
                });
            });

            tbody.querySelectorAll('.edit-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    this.openEditModal(id);
                });
            });

            tbody.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-id');
                    const word = btn.getAttribute('data-word');
                    this.deleteWord(id, word);
                });
            });
        },

        async handleQuickAddForm() {
            const word = this.dom.inputWord.value.trim();
            const meaning_vi = this.dom.inputMeaning.value.trim();
            if (!word || !meaning_vi) {
                showActionToast('⚠️ Vui lòng nhập từ tiếng Anh và nghĩa tiếng Việt!');
                return;
            }

            const payload = {
                word: word,
                phonetic: this.dom.inputPhonetic.value.trim(),
                part_of_speech: this.dom.selectPos.value,
                meaning_vi: meaning_vi,
                category: this.dom.selectCat.value,
                example_en: this.dom.inputExEn.value.trim(),
                example_vi: this.dom.inputExVi.value.trim()
            };

            try {
                const res = await fetch('/api/vocab', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data && data.success) {
                    showActionToast(`✨ Đã thêm từ "${word}" vào sổ tay!`);
                    if (this.dom.formQuickAdd) this.dom.formQuickAdd.reset();
                    this.loadNotebook();
                    this.loadStats();
                    this.loadTodayWords();
                } else {
                    showActionToast(`⚠️ Lỗi: ${data.message || 'Không thể thêm từ'}`);
                }
            } catch (err) {
                console.error('[VocabManager] Quick add error:', err);
                showActionToast('⚠️ Lỗi kết nối khi thêm từ vựng!');
            }
        },

        async toggleLearnedRow(id) {
            try {
                const res = await fetch(`/api/vocab/${id}/toggle-learned`, { method: 'PATCH' });
                const data = await res.json();
                if (data && data.success) {
                    this.loadNotebook();
                    this.loadStats();
                    this.loadTodayWords();
                }
            } catch (err) {
                console.error('[VocabManager] Toggle row learned error:', err);
            }
        },

        openEditModal(id) {
            const item = this.state.notebook.words.find(w => w.id === id);
            if (!item) return;

            if (this.dom.editId) this.dom.editId.value = item.id;
            if (this.dom.editWord) this.dom.editWord.value = item.word;
            if (this.dom.editPhonetic) this.dom.editPhonetic.value = item.phonetic || '';
            if (this.dom.editPos) this.dom.editPos.value = item.part_of_speech || 'Noun';
            if (this.dom.editCat) this.dom.editCat.value = item.category || 'Tech & Networking';
            if (this.dom.editMeaning) this.dom.editMeaning.value = item.meaning_vi;
            if (this.dom.editExEn) this.dom.editExEn.value = item.example_en || '';
            if (this.dom.editExVi) this.dom.editExVi.value = item.example_vi || '';

            if (this.dom.editModal) this.dom.editModal.classList.remove('hidden');
        },

        closeEditModal() {
            if (this.dom.editModal) this.dom.editModal.classList.add('hidden');
        },

        async handleEditFormSubmit() {
            const id = this.dom.editId.value;
            if (!id) return;

            const payload = {
                word: this.dom.editWord.value.trim(),
                phonetic: this.dom.editPhonetic.value.trim(),
                part_of_speech: this.dom.editPos.value,
                category: this.dom.editCat.value,
                meaning_vi: this.dom.editMeaning.value.trim(),
                example_en: this.dom.editExEn.value.trim(),
                example_vi: this.dom.editExVi.value.trim()
            };

            try {
                const res = await fetch(`/api/vocab/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();
                if (data && data.success) {
                    showActionToast('✅ Đã cập nhật thông tin từ vựng!');
                    this.closeEditModal();
                    this.loadNotebook();
                    this.loadTodayWords();
                } else {
                    showActionToast(`⚠️ Lỗi: ${data.message || 'Không thể lưu'}`);
                }
            } catch (err) {
                console.error('[VocabManager] Edit form submit error:', err);
            }
        },

        async deleteWord(id, wordText) {
            if (!confirm(`Bạn có chắc chắn muốn xóa từ vựng "${wordText}" khỏi sổ tay?`)) return;

            try {
                const res = await fetch(`/api/vocab/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (data && data.success) {
                    showActionToast(`🗑️ Đã xóa từ "${wordText}" khỏi hệ thống.`);
                    this.loadNotebook();
                    this.loadStats();
                    this.loadTodayWords();
                }
            } catch (err) {
                console.error('[VocabManager] Delete word error:', err);
            }
        },

        async confirmResetSeeds() {
            if (!confirm('Khôi phục lại 50 từ vựng mẫu chuẩn về Networking, System & Workplace? (Các từ bạn tự tạo vẫn được giữ)')) return;

            try {
                const res = await fetch('/api/vocab/reset-seed', { method: 'POST' });
                const data = await res.json();
                if (data && data.success) {
                    showActionToast('🔄 Đã nạp lại bộ từ vựng mẫu 50+ từ!');
                    this.loadStats();
                    this.loadTodayWords(true);
                    this.loadNotebook();
                }
            } catch (err) {
                console.error('[VocabManager] Reset seeds error:', err);
            }
        },

        // =====================================================================
        // KPIS & STATS
        // =====================================================================
        async loadStats() {
            try {
                const res = await fetch('/api/vocab/stats');
                const data = await res.json();
                if (data && data.success && data.stats) {
                    const st = data.stats;
                    this.state.stats = st;

                    if (this.dom.statTotalWords) this.dom.statTotalWords.textContent = `${st.total_words} Words`;
                    if (this.dom.statLearnedCount) this.dom.statLearnedCount.textContent = `${st.learned_words} / ${st.total_words}`;
                    if (this.dom.statLearnedBar) this.dom.statLearnedBar.style.width = `${st.learned_percentage}%`;
                    if (this.dom.statLearnedPct) this.dom.statLearnedPct.textContent = `${st.learned_percentage}% hoàn thành`;
                    if (this.dom.statStreakDays) this.dom.statStreakDays.textContent = `${st.streak_days} Ngày`;
                    if (this.dom.statTotalReviews) this.dom.statTotalReviews.textContent = `${st.total_reviews} Lượt`;
                }
            } catch (err) {
                console.error('[VocabManager] Load stats error:', err);
            }
        }
    };

    window.vocabManager = vocabManager;

    function renderMarkdownSimple(md) {
        if (!md) return '';
        return md
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/\`(.*?)\`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    // =========================================================================
    // Initialization
    // =========================================================================
    window.scrollTo(0, 0);
    initTheme();               // Initialize Dark / Light theme from localStorage
    initMetricsChart();
    initDiskCharts();
    initAppCharts();
    focusDeckManager.init();    // Initialize Tab 7 Cyber Focus Deck Module
    jarvisVoiceManager.init();   // Initialize Jarvis Voice AI Assistant
    networkRadarManager.init();  // Initialize Tab 8 Network & LAN Radar Module
    powerEstimatorManager.init();// Initialize Tab 9 Power & Carbon Cost Estimator Module
    cyberPetManager.init();      // Initialize Cyber Tamagotchi Virtual Desktop Pet
    wallpaperManager.init();     // Initialize Tab 10 Dynamic Wallpaper Studio Module
    snippetLabManager.init();    // Initialize Tab 11 AI Prompt & Code Snippet Laboratory Module
    mediaViewerManager.init();   // Initialize In-Browser Media & Document Viewer Module
    weatherManager.init();       // Initialize Weather & Dynamic Atmospheric Mood
    vocabManager.init();         // Initialize Tab 12 Daily English & Vocab Booster Module
    featureManager.init();       // Initialize Module Control Center (Feature Toggle Deck)
    setupEvents();
    updateChartsTheme(state.currentTheme === 'light'); // Apply theme styling to charts
    fetchMetricsSnapshot();    // Initial telemetry snapshot
    fetchNotifications(false); // Initial dual-source notification check
    fetchAppSummaryKPIs();     // Initial App Analytics summary KPIs
    connectWebSocket();        // Real-time continuous stream (1s loop with live Action Center sync)

    // Periodic event logs poll every 30 seconds
    state.notifPollTimer = setInterval(() => {
        fetchNotifications(false);
    }, 30000);
});



