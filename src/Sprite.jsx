import {useEffect,useRef} from 'react';
const images=new Map();
export function getImage(src){if(!images.has(src)){const im=new Image();im.src=src;images.set(src,im);}return images.get(src);}
export function drawSprite(ctx,d,x,y,width,height,flip=false){
  const im=getImage(d.image);if(!im.complete||!im.naturalWidth)return;
  const [sx,sy,sw,sh]=d.crop.map((n,i)=>n*(i%2?im.naturalHeight:im.naturalWidth));
  const scale=Math.min(width/sw,height/sh),w=sw*scale,h=sh*scale;
  ctx.save();ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.drawImage(im,sx,sy,sw,sh,-w/2,-h,w,h);ctx.restore();
}
export default function Sprite({d,flip=false,className=''}){
  const ref=useRef();
  useEffect(()=>{const c=ref.current,ctx=c.getContext('2d'),im=getImage(d.image);const draw=()=>{ctx.clearRect(0,0,c.width,c.height);drawSprite(ctx,d,c.width/2,c.height-4,c.width-8,c.height-8,flip);};draw();im.addEventListener('load',draw);return()=>im.removeEventListener('load',draw);},[d,flip]);
  return <canvas ref={ref} width="320" height="220" className={`sprite ${className}`} role="img" aria-label={d.name}/>;
}
