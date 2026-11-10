/* Organic Roads v3. Resource-only local exploration; observed-edge road extraction.
 * Original S01 reference and MIT notice are retained in the distribution. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SlimeLab=factory();})(typeof self!=='undefined'?self:this,function(){
'use strict';
const DEFAULTS={seed:42,particles:1600,sensorDistance:6,sensorAngle:35,turnAngle:25,deposit:.45,diffusion:.2,decay:.025,trailCap:4,foodStrength:3,foodRadius:14,foodRecovery:.006,foodUse:.05,memoryPenalty:.9,memoryLength:12,maturityRate:.015,branchVariation:.015,maxSteps:1600,flowDecay:.012,repeatCooldown:24,corridorSuppression:2.5,roadRadius:2.5,majorRoadRadius:6,roadThreshold:.22,corridorSeparation:6};
const RANGE={seed:[0,2147483647],particles:[100,4000],sensorDistance:[2,16],sensorAngle:[10,80],turnAngle:[5,80],deposit:[.05,2],diffusion:[0,.6],decay:[.005,.12],trailCap:[1,10],foodStrength:[0,8],foodRadius:[4,28],foodRecovery:[0,.05],foodUse:[0,.3],memoryPenalty:[0,4],memoryLength:[0,40],maturityRate:[.002,.1],branchVariation:[0,.15],maxSteps:[100,8000],flowDecay:[.001,.1],repeatCooldown:[0,120],corridorSuppression:[0,12],roadRadius:[.5,6],majorRoadRadius:[.5,12],roadThreshold:[.05,.8],corridorSeparation:[2,8]};
const INTS=new Set(['seed','particles','memoryLength','maxSteps','repeatCooldown']);
const DX=[1,0,-1,0,1,-1,-1,1],DY=[0,1,0,-1,1,1,-1,-1],OP=[2,3,0,1,6,7,4,5];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function random(seed){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function parameters(input={}){const p={};for(const[k,r]of Object.entries(RANGE)){p[k]=input[k]??DEFAULTS[k];if(!Number.isFinite(p[k])||p[k]<r[0]||p[k]>r[1]||(INTS.has(k)&&!Number.isInteger(p[k])))throw Error('Invalid parameter: '+k);}return p;}
function context(input){const n=input?.n,size=input?.size;if(!Number.isInteger(n)||n<16||n>256||!Number.isFinite(size)||size<=0||input.mask?.length!==n*n||input.height?.length!==n*n)throw Error('Invalid terrain snapshot');const mask=Uint8Array.from(input.mask),height=Float32Array.from(input.height);for(let i=0;i<n*n;i++)if(![0,1,2].includes(input.mask[i])||!Number.isFinite(input.height[i])||input.height[i]<0||input.height[i]>1)throw Error('Invalid terrain values');
const resources=(input.resources||[]).map(q=>{if(!['major','minor'].includes(q.type)||!Number.isFinite(q.x)||!Number.isFinite(q.y)||q.x<0||q.y<0||q.x>=size||q.y>=size)throw Error('Only major/minor resources are accepted');return{id:String(q.id),type:q.type,x:q.x,y:q.y};});if(resources.length>200)throw Error('Too many resources');return{n,size,mask,height,resources};}
function legal(t,a,b){if(a<0||b<0||a>=t.mask.length||b>=t.mask.length||t.mask[a]||t.mask[b])return false;const x=a%t.n,y=Math.floor(a/t.n),xx=b%t.n,yy=Math.floor(b/t.n);if(Math.abs(x-xx)>1||Math.abs(y-yy)>1)return false;return x===xx||y===yy||(!t.mask[y*t.n+xx]&&!t.mask[yy*t.n+x]);}
function ray(t,x,y,xx,yy){if(xx<0||yy<0||xx>=t.n||yy>=t.n)return false;const count=Math.max(1,Math.ceil(Math.max(Math.abs(xx-x),Math.abs(yy-y))*3));let a=Math.floor(y)*t.n+Math.floor(x);for(let j=1;j<=count;j++){const b=Math.floor(y+(yy-y)*j/count)*t.n+Math.floor(x+(xx-x)*j/count);if(!legal(t,a,b))return false;a=b;}return true;}
// Undirected IDs make a shuttle on the same edge one reinforcement event.
function edgeKey(n,a,b){if(a>b)[a,b]=[b,a];const d=DX.findIndex((dx,j)=>a%n+dx===b%n&&Math.floor(a/n)+DY[j]===Math.floor(b/n));return d<0?-1:a*8+d;}
class MaxHeap{
 constructor(){this.items=[];}
 push(item){const a=this.items;let i=a.length;a.push(item);while(i){const j=(i-1)>>1;if(a[j].value>=item.value)break;a[i]=a[j];i=j;}a[i]=item;}
 pop(){const a=this.items;if(!a.length)return null;const first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1].value>a[j].value)j++;if(a[j].value<=last.value)break;a[i]=a[j];i=j;}a[i]=last;}return first;}
 get length(){return this.items.length;}
}
function organicExtract(s,backbone){
 const {t,p,mature,walked,sources,support,ticks}=s,n=t.n,L=n*n;
 const adjacency=Array.from({length:L},()=>[]),all=[],core=new Uint8Array(L),cellFlow=new Float32Array(L),cellScore=new Float32Array(L);
 const positive=[];for(let a=0;a<L;a++)if(walked[a]&&mature[a]>0)positive.push(mature[a]);positive.sort((a,b)=>a-b);
 const scale=Math.max(positive[Math.floor(positive.length*.9)]||0,1e-6);
 const field=i=>clamp(mature[i]/scale,0,1);
 for(let a=0;a<L;a++)if(walked[a]&&!t.mask[a])for(let d=0;d<8;d++){
  if(!(walked[a]&(1<<d)))continue;const x=a%n+DX[d],y=Math.floor(a/n)+DY[d],b=y*n+x;
  if(x<0||y<0||x>=n||y>=n||b<=a||!legal(t,a,b))continue;
  const flow=support(edgeKey(n,a,b)),strength=1-Math.exp(-flow/1.5),score=Math.sqrt(Math.min(field(a),field(b))*strength);
  const edge={a,b,flow,score,key:edgeKey(n,a,b)};all.push(edge);adjacency[a].push(edge);adjacency[b].push(edge);cellFlow[a]=Math.max(cellFlow[a],flow);cellFlow[b]=Math.max(cellFlow[b],flow);
 }
 for(let a=0;a<L;a++)cellScore[a]=Math.sqrt(field(a)*(1-Math.exp(-cellFlow[a]/1.5)));
 const selected=backbone.edges.map(e=>[...e]),protectedEdges=backbone.edges.map(e=>[...e]);for(const[a,b]of selected)core[a]=core[b]=1;
 // Multi-source maximum-support growth partitions observed off-backbone space.
 // Collisions between different rooted branches produce whole corridor candidates.
 const owner=new Int32Array(L).fill(-1),parent=new Int32Array(L).fill(-1),quality=new Float32Array(L).fill(-1),heap=new MaxHeap();
 for(let a=0;a<L;a++)if(core[a]){owner[a]=a;quality[a]=1;heap.push({at:a,value:1});}
 while(heap.length){const q=heap.pop(),a=q.at;if(q.value+1e-7<quality[a])continue;
  for(const e of adjacency[a]){if(e.score<.14)continue;const b=e.a===a?e.b:e.a;if(core[b])continue;const v=Math.min(q.value,e.score);if(v>quality[b]+1e-7){quality[b]=v;owner[b]=owner[a];parent[b]=a;heap.push({at:b,value:v});}}
 }
 const endpointDistance=(a,b)=>Math.hypot(a%n-b%n,Math.floor(a/n)-Math.floor(b/n));
 // Spatial separation, not graph distance: adjacent parallel traces are one corridor.
 const distanceFrom=(mask)=>{const dist=new Int16Array(L).fill(-1),queue=[];for(let i=0;i<L;i++)if(mask[i]){dist[i]=0;queue.push(i);}for(let z=0;z<queue.length;z++){const a=queue[z],x=a%n,y=Math.floor(a/n);for(let d=0;d<8;d++){const xx=x+DX[d],yy=y+DY[d];if(xx<0||yy<0||xx>=n||yy>=n)continue;const b=yy*n+xx;if(dist[b]<0){dist[b]=dist[a]+1;queue.push(b);}}}return dist;};
 const originalDistance=distanceFrom(core),candidates=[],seen=new Set();
 for(const e of all){if(e.score<.14||owner[e.a]<0||owner[e.b]<0||owner[e.a]===owner[e.b]||core[e.a]&&core[e.b])continue;
  const left=[],right=[];let a=e.a,b=e.b;while(a>=0&&left.length<n*3){left.push(a);a=parent[a];}while(b>=0&&right.length<n*3){right.push(b);b=parent[b];}
  const cells=[...left.reverse(),...right];if(cells.length<9||endpointDistance(cells[0],cells[cells.length-1])<5)continue;
  const interior=cells.slice(1,-1);if(!interior.some(i=>originalDistance[i]>=p.corridorSeparation))continue;
  const signature=interior.slice().sort((a,b)=>a-b).join(',');if(seen.has(signature))continue;seen.add(signature);
  let sum=0;for(let j=1;j<cells.length;j++){const a=cells[j-1],b=cells[j];const edge=adjacency[a].find(e=>(e.a===a?e.b:e.a)===b);sum+=edge?.score||0;}
  candidates.push({cells,score:sum/(cells.length-1)});
 }
 candidates.sort((a,b)=>b.score-a.score||a.cells[0]-b.cells[0]||a.cells.length-b.cells.length);
 const alternatives=[],used=new Uint8Array(L);let currentDistance=originalDistance;
 for(const c of candidates){const interior=c.cells.slice(1,-1),overlap=interior.filter(i=>used[i]).length/Math.max(1,interior.length);
  const separate=interior.filter(i=>currentDistance[i]>=p.corridorSeparation).length;
  const mid=c.cells[Math.floor(c.cells.length/2)],density=alternatives.reduce((v,x)=>v+Math.exp(-((endpointDistance(mid,x.mid)/(n*.12))**2)),0);
  const effective=c.score/(1+p.corridorSuppression*(overlap*overlap+density*.22));
  if(separate<3||effective<.22||overlap>.65)continue;
  const edges=[];for(let j=1;j<c.cells.length;j++){const a=c.cells[j-1],b=c.cells[j];selected.push([a,b]);edges.push([a,b]);core[a]=core[b]=1;}for(const i of interior)used[i]=1;
  alternatives.push({endpoints:[c.cells[0],c.cells[c.cells.length-1]],cells:c.cells,edges,support:c.score,mid});currentDistance=distanceFrom(core);
 }
 // Deduplicate actual edges; the protected tree is a subset of every result.
 const edgeSet=new Set(),edges=selected.filter(([a,b])=>{const key=edgeKey(n,a,b);if(edgeSet.has(key))return false;edgeSet.add(key);return true;});
 // Road width is a bounded, evidence-gated expansion over actual movement edges.
 // No threshold may remove a protected connection. No diffusion-only cell is painted.
 const major=new Uint8Array(L);for(const q of sources)if(q.type==='major'){
  const x=q.cell%n,y=Math.floor(q.cell/n),r=Math.min(p.foodRadius,12);for(let yy=Math.max(0,Math.floor(y-r));yy<=Math.min(n-1,Math.ceil(y+r));yy++)for(let xx=Math.max(0,Math.floor(x-r));xx<=Math.min(n-1,Math.ceil(x+r));xx++)if((xx-x)**2+(yy-y)**2<=r*r)major[yy*n+xx]=1;
 }
 const roadMask=Uint8Array.from(core),remaining=new Float32Array(L).fill(-1),roadHeap=new MaxHeap();
 for(let a=0;a<L;a++)if(core[a]){const cap=major[a]?p.majorRoadRadius:p.roadRadius,r=.5+(cap-.5)*cellScore[a];remaining[a]=r;roadHeap.push({at:a,value:r});}
 while(roadHeap.length){const q=roadHeap.pop(),a=q.at;if(q.value+1e-6<remaining[a])continue;for(const e of adjacency[a]){const b=e.a===a?e.b:e.a;if(!core[b]&&cellScore[b]<p.roadThreshold)continue;const diagonal=a%n!==b%n&&Math.floor(a/n)!==Math.floor(b/n),limit=major[b]?p.majorRoadRadius:p.roadRadius,v=Math.min(limit,q.value-(diagonal?Math.SQRT2:1));if(v>=0&&v>remaining[b]+1e-6){remaining[b]=v;roadMask[b]=1;roadHeap.push({at:b,value:v});}}}
 const roadCells=[],roadEdges=[];for(let i=0;i<L;i++)if(roadMask[i])roadCells.push(i);for(const e of all)if(roadMask[e.a]&&roadMask[e.b])roadEdges.push([e.a,e.b]);
 // Width is measured across the displayed cell region, in grid units.
 const widths=[];for(let a=0;a<L;a++)if(core[a]){const x=a%n,y=Math.floor(a/n),reach=(dx,dy)=>{let v=0;for(let k=1;k<=24;k++){const xx=x+dx*k,yy=y+dy*k;if(xx<0||yy<0||xx>=n||yy>=n||!roadMask[yy*n+xx])break;v++;}return v;};widths.push(Math.min(1+reach(1,0)+reach(-1,0),1+reach(0,1)+reach(0,-1)));}widths.sort((a,b)=>a-b);
 const q=x=>widths.length?widths[Math.floor((widths.length-1)*x)]:0;
 const widthsStats={unit:'grid cells',min:q(0),p10:q(.1),median:q(.5),p90:q(.9),max:q(1),mean:widths.reduce((a,b)=>a+b,0)/Math.max(1,widths.length)};
 const groupsFromEdges=es=>{const parent=Int32Array.from({length:L},(_,i)=>i),find=a=>{while(parent[a]!==a){parent[a]=parent[parent[a]];a=parent[a];}return a;};for(const[a,b]of es){const u=find(a),v=find(b);parent[u]=v;}const groups=new Map();for(const q of t.resources){const at=Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n),root=find(at);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(q.id);}return[...groups.values()].sort((a,b)=>b.length-a.length);};
 const roadGroups=groupsFromEdges(roadEdges),groups=groupsFromEdges(edges);
 return{...backbone,model:'slime-organic-roads-v3',ticks,edges,cells:core.reduce((a,b)=>a+b,0),protectedEdges,alternatives,alternativeCount:alternatives.length,roadCells,roadEdges,roadGroups,roadGroupCount:roadGroups.length,groups,groupCount:groups.length,largestGroup:groups[0]?.length||0,widths:widthsStats,roadArea:roadCells.length,majorArea:roadCells.filter(i=>major[i]).length,observedEdges:all.length,candidateCorridors:candidates.length};
}

function create(input,settings={}){
const t=context(input),p=parameters(settings),n=t.n,L=n*n,rnd=random(p.seed),trail=new Float32Array(L),next=new Float32Array(L),food=new Float32Array(L),mature=new Float32Array(L),walked=new Uint8Array(L),visits=new Uint32Array(L),last=new Int32Array(L).fill(-1),free=[];
for(let i=0;i<L;i++)if(!t.mask[i])free.push(i);if(!free.length)throw Error('No walkable cells');
// References / attack points are deliberately never copied into the engine.
const sources=[];for(const q of t.resources){const cell=Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n);if(!t.mask[cell])sources.push({...q,cell,reserve:1,contacts:0});}
const kernel=sources.map(q=>{const out=[],x=q.cell%n,y=Math.floor(q.cell/n),r=Math.ceil(p.foodRadius),sigma2=p.foodRadius*p.foodRadius*.32;for(let yy=Math.max(0,y-r);yy<=Math.min(n-1,y+r);yy++)for(let xx=Math.max(0,x-r);xx<=Math.min(n-1,x+r);xx++){const i=yy*n+xx,d=(xx-x)**2+(yy-y)**2;if(!t.mask[i]&&d<=r*r&&ray(t,x+.5,y+.5,xx+.5,yy+.5))out.push([i,Math.exp(-d/sigma2)]);}return out;});
const near=new Int16Array(L).fill(-1);for(let j=0;j<sources.length;j++){const at=sources[j].cell,x=at%n,y=Math.floor(at/n);for(let yy=Math.max(0,y-2);yy<=Math.min(n-1,y+2);yy++)for(let xx=Math.max(0,x-2);xx<=Math.min(n-1,x+2);xx++)if(!t.mask[yy*n+xx])near[yy*n+xx]=j;}
const xs=new Float64Array(p.particles),ys=new Float64Array(p.particles),angles=new Float64Array(p.particles),cooldown=new Uint16Array(p.particles),history=Array.from({length:p.particles},()=>[]);
for(let k=0;k<p.particles;k++){const at=sources.length&&rnd()<.55?sources[k%sources.length].cell:free[Math.floor(rnd()*free.length)];xs[k]=at%n+.5;ys[k]=Math.floor(at/n)+.5;angles[k]=rnd()*Math.PI*2;history[k].push(at);}
const edgeFlow=new Float32Array(L*8),edgeTick=new Int32Array(L*8),edgeMemory=Array.from({length:p.particles},()=>new Map());
function support(key){return edgeFlow[key]*Math.pow(1-p.flowDecay,Math.max(0,ticks-edgeTick[key]));}
function reinforce(k,a,b){const key=edgeKey(n,a,b),memory=edgeMemory[k];if(key<0)return false;const previous=memory.get(key);if(previous!==undefined&&ticks-previous<p.repeatCooldown)return false;memory.set(key,ticks);for(const [id,at]of memory)if(ticks-at>=p.repeatCooldown)memory.delete(id);const value=support(key);edgeFlow[key]=Math.min(12,value+1-value/12);edgeTick[key]=ticks;return true;}
let ticks=0;const sensor=p.sensorAngle*Math.PI/180,turn=p.turnAngle*Math.PI/180,stats={moves:0,blocked:0,resourceContacts:0};
function foodField(){food.fill(0);for(let j=0;j<sources.length;j++)for(const[i,w]of kernel[j])food[i]+=p.foodStrength*sources[j].reserve*w;}
foodField();
function score(k,a){const x=xs[k]+Math.cos(a)*p.sensorDistance,y=ys[k]+Math.sin(a)*p.sensorDistance;if(!ray(t,xs[k],ys[k],x,y))return-1e6;const i=Math.floor(y)*n+Math.floor(x);return trail[i]+food[i]-(history[k].includes(i)?p.memoryPenalty:0);}
function step(){
for(const q of sources)q.contacts=0;
for(let k=0;k<p.particles;k++){
let a=angles[k];const f=score(k,a),l=score(k,a-sensor),r=score(k,a+sensor);if(f<l||f<r){a+=Math.abs(l-r)<1e-6?(rnd()-.5)*turn*2:l>r?-turn:turn;}a+=(rnd()-.5)*.32;
let xx=xs[k]+Math.cos(a)*.85,yy=ys[k]+Math.sin(a)*.85;const before=Math.floor(ys[k])*n+Math.floor(xs[k]);
if(!ray(t,xs[k],ys[k],xx,yy)||!legal(t,before,Math.floor(yy)*n+Math.floor(xx))){stats.blocked++;a+=Math.PI*(.45+rnd()*.9);xx=xs[k];yy=ys[k];}
const after=Math.floor(yy)*n+Math.floor(xx);xs[k]=xx;ys[k]=yy;angles[k]=a;if(cooldown[k])cooldown[k]--;
if(after!==before){const reinforced=reinforce(k,before,after);const d=DX.findIndex((x,j)=>before%n+x===after%n&&Math.floor(before/n)+DY[j]===Math.floor(after/n));if(d>=0){walked[before]|=1<<d;walked[after]|=1<<OP[d];}stats.moves++;visits[after]++;last[after]=ticks;const memory=history[k];const repeated=memory.includes(after);if(!repeated&&reinforced)trail[after]=Math.min(p.trailCap,trail[after]+p.deposit*(1-trail[after]/p.trailCap));memory.push(after);while(memory.length>p.memoryLength)memory.shift();
const source=near[after];if(source>=0&&!cooldown[k]){sources[source].contacts++;cooldown[k]=24;stats.resourceContacts++;}}
}
for(const q of sources)q.reserve=clamp(q.reserve+p.foodRecovery*(1-q.reserve)-p.foodUse*q.contacts/12,.04,1);
for(let i=0;i<L;i++){if(t.mask[i]){next[i]=mature[i]=0;continue;}const x=i%n,y=Math.floor(i/n);let sum=0,count=0;for(let d=0;d<4;d++){const xx=x+DX[d],yy=y+DY[d];if(xx<0||yy<0||xx>=n||yy>=n)continue;const j=yy*n+xx;if(!t.mask[j]){sum+=trail[j];count++;}}next[i]=clamp(((1-p.diffusion)*trail[i]+p.diffusion*(count?sum/count:trail[i]))*(1-p.decay),0,p.trailCap);mature[i]+=(next[i]-mature[i])*p.maturityRate;}
trail.set(next);foodField();ticks++;
}
// Connectivity-preserving reduction of the actual movement graph. The noisy
// priority is sustained trail support, never length / height / route cost.
// Resource anchor cells and every resource-to-resource connection are retained.
function extractBackbone(variation=p.branchVariation){
if(!Number.isFinite(variation)||variation<0||variation>.15)throw Error('Invalid branch variation');
function forest(){const parent=Int32Array.from({length:L},(_,i)=>i),rank=new Uint8Array(L);return{find(a){let b=a;while(parent[b]!==b)b=parent[b];while(parent[a]!==a){const next=parent[a];parent[a]=b;a=next;}return b;},join(a,b){a=this.find(a);b=this.find(b);if(a===b)return false;if(rank[a]<rank[b])[a,b]=[b,a];parent[b]=a;if(rank[a]===rank[b])rank[a]++;return true;}};}
const group=(dsu)=>{const result=new Map();for(const q of t.resources){const at=Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n),root=dsu.find(at);if(!result.has(root))result.set(root,[]);result.get(root).push(q.id);}return[...result.values()].sort((a,b)=>b.length-a.length);};
const raw=forest(),all=[],noise=random((p.seed^0x93f265ab)>>>0);let peak=0;for(const v of mature)peak=Math.max(peak,v);peak=Math.max(peak,1e-9);
for(let a=0;a<L;a++)if(walked[a]&&!t.mask[a])for(let d=0;d<8;d++){if(!(walked[a]&(1<<d)))continue;const xx=a%n+DX[d],yy=Math.floor(a/n)+DY[d],b=yy*n+xx;if(xx<0||yy<0||xx>=n||yy>=n||b<=a||!legal(t,a,b))continue;raw.join(a,b);all.push({a,b,score:(mature[a]+mature[b])/(2*peak)+variation*noise()});}
const rawGroups=group(raw),tree=forest(),edges=[];all.sort((a,b)=>b.score-a.score||a.a-b.a||a.b-b.b);for(const edge of all)if(tree.join(edge.a,edge.b))edges.push([edge.a,edge.b]);
// Only non-resource leaves can be pruned. A weak bridge must survive even if
// its concentration has faded; no unwalked connection is ever added.
const anchors=new Set(t.resources.map(q=>Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n))),adjacent=Array.from({length:L},()=>[]),degree=new Uint8Array(L),keep=new Uint8Array(edges.length).fill(1),queue=[];
edges.forEach(([a,b],i)=>{adjacent[a].push(i);adjacent[b].push(i);degree[a]++;degree[b]++;});for(let i=0;i<L;i++)if(degree[i]===1&&!anchors.has(i))queue.push(i);
for(let z=0;z<queue.length;z++){const a=queue[z];if(degree[a]!==1||anchors.has(a))continue;for(const i of adjacent[a])if(keep[i]){keep[i]=0;degree[a]--;const [u,v]=edges[i],b=u===a?v:u;degree[b]--;if(degree[b]===1&&!anchors.has(b))queue.push(b);}}
const selected=edges.filter((edge,i)=>keep[i]),final=forest(),cells=new Set();for(const[a,b]of selected){final.join(a,b);cells.add(a);cells.add(b);}const groups=group(final),missing=t.resources.filter(q=>{const at=Math.floor(q.y/t.size*n)*n+Math.floor(q.x/t.size*n);return !cells.has(at);}).map(q=>q.id);
return{ticks,variation,edges:selected,cells:cells.size,resourceCount:t.resources.length,groups,rawGroups,groupCount:groups.length,rawGroupCount:rawGroups.length,largestGroup:groups[0]?.length||0,rawLargestGroup:rawGroups[0]?.length||0,missing,observedEdges:all.length,connected:groups.length<=1&&missing.length===0};
}
function extract(variation=p.branchVariation){return organicExtract({t,p,mature,walked,visits,sources,support,ticks},extractBackbone(variation));}
return{t,p,xs,ys,angles,trail,food,mature,walked,visits,last,sources,stats,edgeFlow,edgeTick,support,step,extract,extractBackbone,get ticks(){return ticks;}};
}
return{DEFAULTS,RANGE,parameters,context,create,legal,ray,random,edgeKey,organicExtract,DX,DY};
});
