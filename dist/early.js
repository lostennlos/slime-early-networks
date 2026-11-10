/* Early Networks v4: retain a supported early-stage network, not a late tree.
 * The v3 particle kernel is unchanged. This module adds candidate selection,
 * terrain-aware connectivity targets, immutable snapshots and a stopping rule.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./slime-v3.js'),require('./reference.js'));
  else root.EarlySlimeLab=factory(root.SlimeLab,root.EARLY_REFERENCE);
})(typeof self!=='undefined'?self:this,function(Base,REFERENCE){
  'use strict';
  const MODEL='slime-early-networks-v4';
  const DEFAULT_SELECTION=Object.freeze({startStep:48,preferredStep:60,endStep:120,interval:6,richness:1});
  const SELECTION_RANGE={startStep:[6,240],preferredStep:[6,240],endStep:[12,240],interval:[1,24],richness:[.5,1.8]};
  const clone=value=>structuredClone(value);
  function parameters(value={}){
    const selection={...DEFAULT_SELECTION,...value.selection};
    for(const[key,[min,max]]of Object.entries(SELECTION_RANGE)){
      const v=selection[key];
      if(!Number.isFinite(v)||v<min||v>max||(key!=='richness'&&!Number.isInteger(v)))throw Error('Invalid early selection setting: '+key);
    }
    if(selection.startStep>selection.preferredStep||selection.preferredStep>selection.endStep)throw Error('Early window must satisfy start ≤ preferred ≤ end');
    const simulation=Base.parameters({...value.simulation,maxSteps:Math.max(100,selection.endStep)});
    return{simulation,selection};
  }
  function terrainTargets(input){
    const t=Base.context(input),n=t.n,L=n*n,labels=new Int32Array(L).fill(-1),queue=new Int32Array(L);
    let freeCells=0,component=0;const ids=new Set(),blockedResources=[],groups=new Map();
    for(let a=0;a<L;a++){
      if(t.mask[a])continue;freeCells++;
      if(labels[a]>=0)continue;
      let head=0,tail=0;queue[tail++]=a;labels[a]=component;
      while(head<tail){const at=queue[head++],x=at%n,y=Math.floor(at/n);
        for(let d=0;d<4;d++){const xx=x+Base.DX[d],yy=y+Base.DY[d];if(xx<0||yy<0||xx>=n||yy>=n)continue;const b=yy*n+xx;if(!t.mask[b]&&labels[b]<0){labels[b]=component;queue[tail++]=b;}}
      }
      component++;
    }
    for(const q of t.resources){
      if(!q.id||ids.has(q.id))throw Error('Resource IDs must be non-empty and unique');ids.add(q.id);
      const cell=Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n);
      if(t.mask[cell]){blockedResources.push(q.id);continue;}
      const group=labels[cell];if(!groups.has(group))groups.set(group,[]);groups.get(group).push(q.id);
    }
    const feasibleGroups=[...groups.values()],validIds=new Set(feasibleGroups.flat()),requiredIds=new Set(feasibleGroups.filter(g=>g.length>1).flat());
    const expectedPairs=feasibleGroups.reduce((sum,g)=>sum+g.length*(g.length-1)/2,0);
    return{freeCells,feasibleGroups,expectedPairs,validIds,requiredIds,blockedResources,resourceCount:t.resources.length};
  }
  function describe(network,t,targets){
    const activeGroups=network.groups.map(g=>g.filter(id=>targets.validIds.has(id))).filter(g=>g.length);
    const observedPairs=activeGroups.reduce((sum,g)=>sum+g.length*(g.length-1)/2,0);
    const pairCoverage=targets.expectedPairs?observedPairs/targets.expectedPairs:1;
    const missingRequired=network.missing.filter(id=>targets.requiredIds.has(id));
    const ready=pairCoverage>=1-1e-9&&missingRequired.length===0&&targets.blockedResources.length===0;
    const scale=t.n/REFERENCE.n;
    return{ready,pairCoverage,missingRequired,blockedResources:[...targets.blockedResources],
      feasibleGroupCount:targets.feasibleGroups.length,actualGroupCount:activeGroups.length,
      alternativeDensity:network.alternativeCount/Math.max(1,targets.validIds.size),
      coverage:network.roadArea/Math.max(1,targets.freeCells),
      width:network.widths.median/scale,spread:(network.widths.p90-network.widths.p10)/scale};
  }
  function score(features,step,selection){
    const target=REFERENCE.features,density=target.alternativeDensity*selection.richness;
    const terms={
      alternatives:.5*Math.abs(features.alternativeDensity-density)/Math.max(.25,density),
      area:.25*Math.abs(features.coverage-target.coverage)/Math.max(.02,target.coverage),
      width:.15*Math.abs(features.width-target.width)/Math.max(1,target.width),
      variation:.05*Math.abs(features.spread-target.spread)/Math.max(1,target.spread),
      timing:.05*Math.abs(step-selection.preferredStep)/Math.max(1,selection.endStep-selection.startStep)
    };
    return{value:Object.values(terms).reduce((a,b)=>a+b,0),terms};
  }
  function create(input,value={},options={}){
    const settings=parameters(value),simulation=Base.create(input,settings.simulation),targets=terrainTargets(input),candidates=[];
    let phase='exploring',reason='exploring',best=null,selected=null;
    function better(a,b){
      if(!b)return true;
      if(a.features.ready!==b.features.ready)return a.features.ready;
      if(!a.features.ready&&Math.abs(a.features.pairCoverage-b.features.pairCoverage)>1e-9)return a.features.pairCoverage>b.features.pairCoverage;
      return a.score.value<b.score.value-1e-10||Math.abs(a.score.value-b.score.value)<1e-10&&a.step<b.step;
    }
    function capture(){
      const old=candidates.find(c=>c.step===simulation.ticks);if(old)return old;
      const network=simulation.extract(),features=describe(network,simulation.t,targets);
      const candidate={step:simulation.ticks,network,features,score:score(features,simulation.ticks,settings.selection),
        fields:{trail:Float32Array.from(simulation.trail),food:Float32Array.from(simulation.food)},
        movement:Uint8Array.from(simulation.walked)};
      candidates.push(candidate);candidates.sort((a,b)=>a.step-b.step);
      if(better(candidate,best))best=candidate;
      return candidate;
    }
    function finish(why='window-complete'){
      if(!best)capture();selected=best;phase=selected.features.ready?'retained':'incomplete';reason=why;
      return selected;
    }
    function step(){
      if(phase!=='exploring')return selected;
      if(simulation.ticks>=settings.selection.endStep)return finish();
      simulation.step();const at=simulation.ticks,s=settings.selection;
      const checkpoint=at>=s.startStep&&((at-s.startStep)%s.interval===0||at===s.preferredStep||at===s.endStep);
      if(checkpoint){const candidate=capture();if(!options.replay&&candidate.features.ready&&candidate.score.value<1e-10)return finish('reference-match');}
      if(at===s.endStep)return finish();
      return best;
    }
    function choose(step){
      const candidate=candidates.find(c=>c.step===step);if(!candidate)throw Error('Candidate step is not available');
      selected=candidate;phase=candidate.features.ready?'retained':'incomplete';reason='manual-candidate';return candidate;
    }
    function stop(){capture();return finish('manual-stop');}
    function run(){while(phase==='exploring')step();return selected;}
    function preview(){
      return selected||best||{step:simulation.ticks,network:null,features:null,fields:{trail:simulation.trail,food:simulation.food}};
    }
    function exportResult(){
      if(!selected)throw Error('Retain a candidate before saving');
      return{format:'slime-early-experiment-v1',model:MODEL,settings:clone(settings),exploredSteps:simulation.ticks,selectedStep:selected.step,reason,
        reference:{basis:REFERENCE.basis,step:REFERENCE.step,features:clone(REFERENCE.features),sourceSha256:REFERENCE.sourceSha256},
        candidates:candidates.map(c=>({step:c.step,features:clone(c.features),score:clone(c.score),alternatives:c.network.alternativeCount,roadArea:c.network.roadArea})),
        snapshot:{network:clone(selected.network),features:clone(selected.features),fields:{trail:Array.from(selected.fields.trail),food:Array.from(selected.fields.food)}}};
    }
    return{settings,simulation,targets,step,capture,choose,stop,run,preview,exportResult,
      get phase(){return phase;},get reason(){return reason;},get ticks(){return simulation.ticks;},get candidates(){return candidates;},get best(){return best;},get selected(){return selected;}};
  }
  function restore(input,payload){
    if(payload?.format!=='slime-early-experiment-v1'||payload.model!==MODEL)throw Error('Unknown early-network experiment');
    const settings=parameters(payload.settings),end=payload.exploredSteps,chosen=payload.selectedStep;
    if(!Number.isInteger(end)||end<0||end>settings.selection.endStep||!Number.isInteger(chosen)||chosen<0||chosen>end)throw Error('Invalid early-network replay steps');
    const result=create(input,settings,{replay:true});
    if(chosen===0)result.capture();
    while(result.ticks<end){result.step();if(result.ticks===chosen)result.capture();}
    result.choose(chosen);return result;
  }
  return{MODEL,DEFAULT_SELECTION,SELECTION_RANGE,parameters,terrainTargets,describe,score,create,restore,REFERENCE,Base};
});
