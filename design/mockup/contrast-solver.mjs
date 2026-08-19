const hex=h=>({r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)});
const to=c=>'#'+[c.r,c.g,c.b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};
const L=c=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)};

const light={bg:'#ffffff',panel:'#fafafb',rail:'#f4f5f8',hover:'#f6f7f9'};
const dark ={bg:'#0a0c11',panel:'#11141b',rail:'#141821',hover:'#161a23'};
const tok={light:{ink:'#0b0d12',muted:'#5f636d',faint:'#979da8',up:'#bf342a',down:'#1a4ed6'},
           dark :{ink:'#eef0f4',muted:'#989eaa',faint:'#6a707c',up:'#ff6f63',down:'#7fa2ff'}};

// 색상(hue)은 유지하고 명도만 목표 대비까지 밀어 넣는다.
function solve(fg,surfaces,target,darkMode){
  const f=hex(fg); const worst=()=>Math.min(...surfaces.map(s=>cr(f,hex(s))));
  let c={...f}, best=null;
  for(let i=0;i<255;i++){
    const w=Math.min(...surfaces.map(s=>cr(c,hex(s))));
    if(w>=target){best={...c};break;}
    const step=darkMode?1:-1;              // 다크는 밝히고, 라이트는 어둡게
    c={r:c.r+step,g:c.g+step,b:c.b+step};
  }
  return {from:fg,worstBefore:+worst().toFixed(2),to:best?to(best):null,
          worstAfter:best?+Math.min(...surfaces.map(s=>cr(best,hex(s)))).toFixed(2):null};
}
const LS=Object.values(light), DS=Object.values(dark);
console.log('surface 최악 기준(라이트: bg/panel/rail/hover 중 최악)');
for(const [name,val] of Object.entries(tok.light)){
  const r=solve(val,LS,4.5,false);
  console.log(`  light --${name.padEnd(6)} ${r.from} 대비 ${String(r.worstBefore).padStart(5)}  ${r.worstBefore>=4.5?'PASS':'FAIL → '+r.to+' ('+r.worstAfter+')'}`);
}
for(const [name,val] of Object.entries(tok.dark)){
  const r=solve(val,DS,4.5,true);
  console.log(`  dark  --${name.padEnd(6)} ${r.from} 대비 ${String(r.worstBefore).padStart(5)}  ${r.worstBefore>=4.5?'PASS':'FAIL → '+r.to+' ('+r.worstAfter+')'}`);
}
