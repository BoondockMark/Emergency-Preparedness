// Dependency-free, deterministic PDF generator for the physical printer test sheet.
const W=612,H=792;
const esc=s=>String(s).replace(/([\\()])/g,'\\$1');
const text=(x,y,size,value,bold=false)=>`BT /F${bold?2:1} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET\n`;
const line=(x1,y1,x2,y2,width=.5)=>`${width} w ${x1} ${y1} m ${x2} ${y2} l S\n`;
const rect=(x,y,w,h,gray=null)=>`${gray===null?'':`${gray} g `}${x} ${y} ${w} ${h} re ${gray===null?'S':'B'}\n0 g `;
function common(back=false){
  let s=rect(.5,.5,W-1,H-1)+rect(18,18,W-36,H-36)+`[3 3] 0 d ${rect(36,36,W-72,H-72)}[] 0 d `;
  const bindingX=back?W-54:18,stripX=back?18:W-34;
  s+=`0.9 g ${bindingX} 18 36 ${H-36} re f 0 g ${rect(bindingX,18,36,H-36)}1 g ${stripX} 18 16 ${H-36} re f 0 g `;
  s+=text(bindingX+5,390,7,'BINDING / PUNCH',true)+text(bindingX+8,380,7,'CLEARANCE',true);
  return s;
}
function ruler(x,y,inches){let s=line(x,y,x+inches*72,y,1);for(let i=0;i<=inches*8;i++){const tall=i%8===0?18:i%4===0?12:7;s+=line(x+i*9,y,x+i*9,y+tall);if(i%8===0)s+=text(x+i*9-2,y+22,7,i/8)}return s}
function target(x,y,label){let s=rect(x-22,y-22,44,44)+line(x-26,y,x+26,y)+line(x,y-26,x,y+26);return s+text(x-14,y-4,6,label)}
function front(){
  let s=common(false)+text(62,750,18,'Printer qualification calibration - FRONT',true)+text(62,733,8,'US Letter | Actual size / 100% | duplex long-edge | do not fit or shrink');
  s+=text(62,710,10,'Horizontal inch ruler - verify with a physical ruler',true)+ruler(62,682,6.5);
  const levels=[0,10,20,40,60,80,100];s+=text(62,648,10,'Grayscale separation',true);[1,.9,.8,.6,.4,.2,0].forEach((g,i)=>{s+=rect(62+i*70,602,70,35,g)+text(84+i*70,616,7,`${levels[i]}%`)});
  s+=text(62,580,10,'Minimum type samples',true)+text(62,562,7,'7 pt: Emergency instructions must remain complete and legible. 0123456789')+text(62,547,8,'8 pt: Emergency instructions must remain complete and legible. 0123456789')+text(62,531,9,'9 pt: Emergency instructions must remain complete and legible. 0123456789')+text(62,513,10,'10 pt bold: WARNING / ACTION / LOCATION',true);
  s+=text(62,487,10,'Alignment and scale target',true)+rect(62,382,490,90)+line(307,382,307,472)+line(62,427,552,427)+text(215,423,7,'measure center cross from every edge');
  s+=rect(62,325,490,38)+text(120,339,14,'TOP ^ FRONT - OUTSIDE STRIP MUST BE RIGHT',true);
  s+=target(100,250,'LEFT')+target(307,250,'CENTER')+target(515,250,'RIGHT')+text(62,45,7,'Solid line = page boundary | dashed line = 0.5 inch inset | Calibration v1 | page 1 of 2');return s;
}
function back(){
  let s=common(true)+text(62,750,18,'Printer qualification calibration - BACK',true)+text(62,733,8,'Turn the portrait sheet like a book: this arrow remains up and the outside strip is LEFT.');
  s+=rect(62,675,490,38)+text(126,689,14,'TOP ^ BACK - OUTSIDE STRIP MUST BE LEFT',true)+text(62,646,10,'Outside-edge strip and duplex registration',true)+text(62,632,8,'Hold to a light; record the greatest horizontal and vertical offset between targets and strip ends.')+rect(62,520,490,95)+line(307,520,307,615)+line(62,567.5,552,567.5);
  s+=text(62,495,10,'Vertical metric ruler - 100 mm reference',true)+line(80,210,80,493,1);for(let i=0;i<=100;i++){let y=210+i*2.83465;s+=line(80,y,80+(i%10===0?18:i%5===0?12:6),y);if(i%10===0)s+=text(102,y-2,7,`${i} mm`)}
  s+=text(190,470,10,'Qualification observations',true)+text(190,450,8,'[ ] boundaries unclipped    [ ] rulers accurate')+text(190,434,8,'[ ] grayscale distinct       [ ] 7 pt and 8 pt legible')+text(190,418,8,'[ ] punch clearance passes   [ ] reverse upright')+text(190,385,10,'Measured alignment',true)+text(190,365,8,'Horizontal offset: ______ mm')+text(190,349,8,'Vertical offset:   ______ mm')+text(190,333,8,'1-inch ruler: ____ in   metric ruler: ____ mm')+target(220,260,'LEFT')+target(355,260,'CENTER')+target(490,260,'RIGHT')+text(62,45,7,'Solid line = page boundary | dashed line = 0.5 inch inset | Calibration v1 | page 2 of 2');return s;
}
export function createCalibrationPdf(){
  const streams=[front(),back()],objects=[];
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';objects[2]='<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>';
  objects[3]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 7 0 R >>';
  objects[4]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 8 0 R >>';
  objects[5]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';objects[6]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  objects[7]=`<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}endstream`;objects[8]=`<< /Length ${Buffer.byteLength(streams[1])} >>\nstream\n${streams[1]}endstream`;
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf);pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);
}
