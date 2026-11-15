// Translations of the sidebar group and item labels, keyed by the English label in
// astro.config.mjs. Starlight takes them as `translations` keyed by BCP-47 language tag.
export const sidebarLabels = {
	'Getting started': { es: 'Primeros pasos', de: 'Erste Schritte', ja: 'はじめに', 'zh-CN': '入门', ko: '시작하기' },
	'Why Fireemu': { es: 'Por qué Fireemu', de: 'Warum Fireemu', ja: 'Fireemuを選ぶ理由', 'zh-CN': '为什么选择 Fireemu', ko: '왜 Fireemu인가' },
	'Install and run': { es: 'Instalar y ejecutar', de: 'Installieren und starten', ja: 'インストールと実行', 'zh-CN': '安装并运行', ko: '설치 및 실행' },
	'Connect your app': { es: 'Conectar tu app', de: 'App verbinden', ja: 'アプリを接続する', 'zh-CN': '连接你的应用', ko: '앱 연결하기' },
	'Migrate from the Local Emulator Suite': {
		es: 'Migrar desde Local Emulator Suite',
		de: 'Von der Local Emulator Suite migrieren',
		ja: 'Local Emulator Suiteからの移行',
		'zh-CN': '从 Local Emulator Suite 迁移',
		ko: 'Local Emulator Suite에서 마이그레이션',
	},
	Products: { es: 'Productos', de: 'Produkte', ja: 'プロダクト', 'zh-CN': '产品', ko: '제품' },
	'Cloud Firestore': { es: 'Cloud Firestore', de: 'Cloud Firestore', ja: 'Cloud Firestore', 'zh-CN': 'Cloud Firestore', ko: 'Cloud Firestore' },
	Authentication: { es: 'Authentication', de: 'Authentication', ja: 'Authentication', 'zh-CN': 'Authentication', ko: 'Authentication' },
	'Cloud Storage': { es: 'Cloud Storage', de: 'Cloud Storage', ja: 'Cloud Storage', 'zh-CN': 'Cloud Storage', ko: 'Cloud Storage' },
	'Cloud Functions': { es: 'Cloud Functions', de: 'Cloud Functions', ja: 'Cloud Functions', 'zh-CN': 'Cloud Functions', ko: 'Cloud Functions' },
	'Cloud Functions (Python)': {
		es: 'Cloud Functions (Python)',
		de: 'Cloud Functions (Python)',
		ja: 'Cloud Functions（Python）',
		'zh-CN': 'Cloud Functions（Python）',
		ko: 'Cloud Functions (Python)',
	},
	'Pub/Sub and Eventarc': { es: 'Pub/Sub y Eventarc', de: 'Pub/Sub und Eventarc', ja: 'Pub/SubとEventarc', 'zh-CN': 'Pub/Sub 和 Eventarc', ko: 'Pub/Sub 및 Eventarc' },
	'Realtime Database': { es: 'Realtime Database', de: 'Realtime Database', ja: 'Realtime Database', 'zh-CN': 'Realtime Database', ko: 'Realtime Database' },
	'Firebase Hosting': { es: 'Firebase Hosting', de: 'Firebase Hosting', ja: 'Firebase Hosting', 'zh-CN': 'Firebase Hosting', ko: 'Firebase Hosting' },
	'App Check': { es: 'App Check', de: 'App Check', ja: 'App Check', 'zh-CN': 'App Check', ko: 'App Check' },
	Guides: { es: 'Guías', de: 'Anleitungen', ja: 'ガイド', 'zh-CN': '指南', ko: '가이드' },
	'Configuration files': { es: 'Archivos de configuración', de: 'Konfigurationsdateien', ja: '設定ファイル', 'zh-CN': '配置文件', ko: '구성 파일' },
	'Profiles and productionExact': {
		es: 'Perfiles y productionExact',
		de: 'Profile und productionExact',
		ja: 'プロファイルとproductionExact',
		'zh-CN': '配置与 productionExact',
		ko: '프로필과 productionExact',
	},
	'Security Rules': { es: 'Security Rules', de: 'Security Rules', ja: 'Security Rules', 'zh-CN': 'Security Rules', ko: 'Security Rules' },
	'Time and scheduled functions': {
		es: 'Tiempo y funciones programadas',
		de: 'Zeit und geplante Funktionen',
		ja: '時間とスケジュール関数',
		'zh-CN': '时间与定时函数',
		ko: '시간과 예약 함수',
	},
	'Test worlds': { es: 'Mundos de prueba', de: 'Testwelten', ja: 'テストワールド', 'zh-CN': '测试世界', ko: '테스트 월드' },
	'Export and import data': { es: 'Exportar e importar datos', de: 'Daten exportieren und importieren', ja: 'データのエクスポートとインポート', 'zh-CN': '导出和导入数据', ko: '데이터 내보내기 및 가져오기' },
	'Emulator UI': { es: 'Emulator UI', de: 'Emulator UI', ja: 'Emulator UI', 'zh-CN': 'Emulator UI', ko: 'Emulator UI' },
	'CI and containers': { es: 'CI y contenedores', de: 'CI und Container', ja: 'CIとコンテナ', 'zh-CN': 'CI 和容器', ko: 'CI와 컨테이너' },
	Troubleshooting: { es: 'Solución de problemas', de: 'Fehlerbehebung', ja: 'トラブルシューティング', 'zh-CN': '问题排查', ko: '문제 해결' },
	Compatibility: { es: 'Compatibilidad', de: 'Kompatibilität', ja: '互換性', 'zh-CN': '兼容性', ko: '호환성' },
	'Compatibility tables': { es: 'Tablas de compatibilidad', de: 'Kompatibilitätstabellen', ja: '互換性の表', 'zh-CN': '兼容性表', ko: '호환성 표' },
	Limitations: { es: 'Limitaciones', de: 'Einschränkungen', ja: '制限事項', 'zh-CN': '限制', ko: '제한 사항' },
	Performance: { es: 'Rendimiento', de: 'Leistung', ja: 'パフォーマンス', 'zh-CN': '性能', ko: '성능' },
	Reference: { es: 'Referencia', de: 'Referenz', ja: 'リファレンス', 'zh-CN': '参考', ko: '참조' },
	CLI: { es: 'CLI', de: 'CLI', ja: 'CLI', 'zh-CN': 'CLI', ko: 'CLI' },
	'Configuration schema': { es: 'Esquema de configuración', de: 'Konfigurationsschema', ja: '設定のスキーマ', 'zh-CN': '配置架构', ko: '구성 스키마' },
	'Environment variables': { es: 'Variables de entorno', de: 'Umgebungsvariablen', ja: '環境変数', 'zh-CN': '环境变量', ko: '환경 변수' },
};

/** Adds `translations` to every group and item of a Starlight sidebar; an unknown label throws. */
export function translateSidebar(items) {
	return items.map((item) => {
		const translations = sidebarLabels[item.label];
		if (!translations) throw new Error(`sidebar label "${item.label}" has no translations in src/i18n/sidebar.mjs`);
		const out = { ...item, translations };
		if (item.items) out.items = translateSidebar(item.items);
		return out;
	});
}
