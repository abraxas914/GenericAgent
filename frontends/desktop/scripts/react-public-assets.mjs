export const REQUIRED_REACT_PUBLIC_ASSETS = [
  'THIRD_PARTY_NOTICES.txt',
  'fallback.html',
  'assets/ga-logo.svg',
];

export const SEMI_UI_NOTICE_CONTRACT = Object.freeze({
  packageName: '@douyinfe/semi-ui',
  packageVersion: '2.101.0',
  publicAsset: 'THIRD_PARTY_NOTICES.txt',
  sha256: '2acf865e87e59090121369aac0575467067fdd7999923a70d785a46ceae3330f',
});

export const REQUIRED_REACT_PUBLIC_ASSET_SHA256 = Object.freeze({
  [SEMI_UI_NOTICE_CONTRACT.publicAsset]: SEMI_UI_NOTICE_CONTRACT.sha256,
});

export const REMOVED_LEGACY_REACT_PUBLIC_ASSETS = [
  'styles.css',
  'i18n.js',
  'phosphor-icons.js',
  'vendor/marked.min.js',
  'assets/fonts/fonts.css',
  'assets/fonts/README.md',
  'assets/fonts/azonix-wordmark.woff2',
  'assets/fonts/jetbrains-mono-latin.woff2',
  'assets/fonts/lexend-latin.woff2',
  'assets/fonts/noto-sans-latin.woff2',
];
