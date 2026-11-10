const fs=require('node:fs'),path=require('node:path');
const root=__dirname,dist=path.join(root,'dist'),out=path.join(root,'outputs');fs.mkdirSync(out,{recursive:true});
let html=fs.readFileSync(path.join(dist,'index.html'),'utf8');html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(dist,'style.css'),'utf8')+'</style>');
const scripts=['slime-v3.js','reference.js','early.js','context.js','app.js'].map(name=>{html=html.replace('<script defer src="'+name+'"></script>','');return '<script>'+fs.readFileSync(path.join(dist,name),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>';});
const license=fs.readFileSync(path.join(dist,'LICENSE-upstream.txt'),'utf8');html=html.replace('</body>',()=>'<script type="text/plain" id="upstream-license">'+license.replace(/<\/script/gi,'<\\/script')+'</script>\n'+scripts.join('\n')+'\n</body>');
fs.writeFileSync(path.join(out,'黏菌路网_v4_早期丰富形态实验台.html'),html);console.log(JSON.stringify({bytes:Buffer.byteLength(html),externalScripts:/<script[^>]+src=/.test(html)}));
