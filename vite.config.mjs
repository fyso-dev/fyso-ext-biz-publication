// Standard static page build. React and panel APIs are shared native ES modules.
export default {
  root:new URL('./panel-src',import.meta.url).pathname,
  base:'/extensions/biz-publication/panel/',
  build:{outDir:new URL('./extensions/biz-publication/panel',import.meta.url).pathname,emptyOutDir:true,
    rollupOptions:{external:['@fyso/panel','react','react/jsx-runtime','react-i18next'],
      output:{paths:{'@fyso/panel':'/assets/extension-sdk.js',react:'/assets/extension-sdk.js','react/jsx-runtime':'/assets/extension-sdk.js','react-i18next':'/assets/extension-sdk.js'},entryFileNames:'main.js',assetFileNames:'[name][extname]'}}},
};
