// Reuse the host's pinned build tools and SDK types; runtime assets are independent.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const host=process.env.FYSO_FRAMEWORK_ROOT;
if(!host)throw Error('Set FYSO_FRAMEWORK_ROOT to a framework checkout or generated project with panel API v3.');
const panel=fs.existsSync(path.join(host,'template/framework/panel'))?path.join(host,'template/framework/panel'):path.join(host,'framework/panel');
const api=JSON.parse(fs.readFileSync(path.join(panel,'extension-api.json'),'utf8'));
if(!(api.version>=3))throw Error('Panel extension API v3 or later (project identity) is required.');
const data=path.join(root,'.data/build');fs.mkdirSync(data,{recursive:true});
const config={extends:path.join(root,'tsconfig.json'),compilerOptions:{baseUrl:root,ignoreDeprecations:'6.0',paths:{'@fyso/panel':[path.join(panel,'src/extension-sdk.tsx')],'react/jsx-runtime':[path.join(panel,'node_modules/@types/react/jsx-runtime.d.ts')]}},include:[path.join(root,'panel-src'),path.join(panel,'node_modules/vite/client.d.ts')]};
const file=path.join(data,'tsconfig.json');fs.writeFileSync(file,JSON.stringify(config));
execFileSync(process.execPath,[path.join(panel,'node_modules/typescript/bin/tsc'),'-p',file,'--noEmit'],{cwd:root,stdio:'inherit'});
execFileSync(process.execPath,[path.join(panel,'node_modules/vite/bin/vite.js'),'build','--config',path.join(root,'vite.config.mjs')],{cwd:root,stdio:'inherit'});
