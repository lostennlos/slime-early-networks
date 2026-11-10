/* Run the real import adapter with UI callbacks stubbed, so no native picker
 * is needed to verify legacy migration and selected-frame restoration. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const E=require('../dist/early.js'),root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'dist/app.js'),'utf8');
const raw=fs.readFileSync(path.join(root,'dist/context.js'),'utf8'),data=JSON.parse(raw.slice(raw.indexOf('=')+1,-1));
const startCode=app.slice(app.indexOf('function start('),app.indexOf('function stats('));
const importCode=app.slice(app.indexOf('function validContext('),app.indexOf('function frame('));
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,options:[{},{}]});return elements.get(id);};
const env={E,SLIME_CONTEXT:data,data:structuredClone(data),variant:0,engine:null,generating:false,replaying:false,generation:0,lastCandidates:0,view:'roads',structuredClone,setTimeout,Number,Error,
 $:element,stats(){},renderCandidates(){},draw(){},fillSettings(s){env.filled=s;},setView(v){env.view=v;},status(zh,en){env.message=[zh,en];},finishStatus(){},
 context(){return{...env.data,resources:env.data.variants[env.variant].resources};}};vm.createContext(env);vm.runInContext(startCode+'\n'+importCode,env);
async function run(){
 const sample=JSON.parse(fs.readFileSync(path.join(root,'outputs/黏菌路网_v4_P1蓝本_60步.json'),'utf8'));
 await env.load(sample);assert.equal(env.engine.selected.step,60);assert.deepEqual(env.engine.selected.network,sample.snapshot.network);assert.equal(env.replaying,false);assert.equal(env.generating,false);
 const manual=E.create({...data,resources:data.variants[0].resources});manual.run();manual.choose(48);const m=manual.exportResult();m.context=data;m.variant=0;await env.load(m);assert.equal(env.engine.selected.step,48);assert.equal(env.engine.selected.network.alternativeCount,30);
 const legacy={format:'slime-experiment-v2',model:'slime-organic-roads-v3',context:data,variant:0,parameters:{...E.Base.DEFAULTS},ticks:800};await env.load(legacy);assert.equal(env.generating,true);env.engine.run();assert.equal(env.engine.selected.step,60);assert.equal(env.engine.selected.network.roadArea,5421);assert.ok(env.message[1].includes('Legacy settings'));
 const previous=env.engine,previousData=env.data;await assert.rejects(env.load({...sample,selectedStep:200}));assert.equal(env.engine,previous);assert.equal(env.data,previousData);await assert.rejects(env.load({...sample,model:'unknown-model'}));assert.equal(env.engine,previous);
 await env.load(data);assert.equal(env.engine.settings.simulation.seed,42);assert.equal(env.variant,0);env.engine.run();assert.equal(env.engine.selected.step,60);
 const altered=structuredClone(sample);altered.snapshot.network.edges=[[0,1000]];await env.load(altered);assert.deepEqual(env.engine.selected.network,sample.snapshot.network);
 const report={passed:true,checks:['v4 selected-frame import','manual 48-step import','old 800-step v3 input regenerates an early 60-step network','invalid bounds and unknown models do not replace the current data','raw terrain input','imported geometry is recomputed rather than trusted']};fs.writeFileSync(path.join(root,'outputs/import-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
run().catch(error=>{console.error(error);process.exitCode=1;});
