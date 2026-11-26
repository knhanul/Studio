import type {ButtonHTMLAttributes,ReactNode} from 'react';
import {Sparkles} from 'lucide-react';
/** 고모 창작실과 같은 버튼·카드·입력 틀 */
export function Button({children,kind='primary',size='md',className='',...rest}:ButtonHTMLAttributes<HTMLButtonElement>&{kind?:'primary'|'secondary'|'ghost'|'outline'|'danger',size?:'sm'|'md'|'lg'}){
  return <button type="button" className={`btn btn-${kind} btn-${size} ${className}`} {...rest}>{children}</button>;
}
export function IconButton({label,children,onClick,disabled,active=false,danger=false}:{label:string;children:ReactNode;onClick?:()=>void;disabled?:boolean;active?:boolean;danger?:boolean}){
  return <button type="button" className={`icon-btn ${active?'is-active':''} ${danger?'is-danger':''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export function Tag({children,tone='muted'}:{children:ReactNode;tone?:'muted'|'accent'|'success'|'warning'}){return <span className={`tag tag-${tone}`}>{children}</span>;}
export function Field({label,description,children,className=''}:{label:ReactNode,description?:ReactNode,children:ReactNode,className?:string}){return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{description&&<small>{description}</small>}</label>;}
export function Empty({title,description,action,icon}:{title:string;description:string;action?:ReactNode;icon?:ReactNode}){return <div className="empty"><div className="empty-icon">{icon||<Sparkles size={25}/>}</div><h3>{title}</h3><p>{description}</p>{action}</div>;}
export function Section({title,children,aside}:{title:string;children:ReactNode;aside?:ReactNode}){return <section className="ps-section"><div className="ps-section-head"><strong>{title}</strong>{aside}</div>{children}</section>;}
/** 슬라이더 + 값 표시 */
export function Slider({label,value,min,max,step,onChange,format,description}:{label:string;value:number;min:number;max:number;step:number;onChange:(v:number)=>void;format?:(v:number)=>string;description?:string}){
  return <label className="field slider-field"><span className="field-label">{label}<b>{format?format(value):value}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/>{description&&<small>{description}</small>}</label>;
}
export function Toggle({label,checked,onChange,description}:{label:string;checked:boolean;onChange:(v:boolean)=>void;description?:string}){
  return <label className="toggle-row"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span className="toggle-ui" aria-hidden="true"/><span className="toggle-text"><strong>{label}</strong>{description&&<small>{description}</small>}</span></label>;
}
/** 여러 개 중 하나 고르기 (작은 버튼 묶음) */
export function Segmented<T extends string|number>({value,options,onChange,label}:{value:T;options:{id:T;label:string}[];onChange:(v:T)=>void;label?:string}){
  return <div className="segmented" role="radiogroup" aria-label={label}>{options.map(o=><button type="button" key={String(o.id)} role="radio" aria-checked={o.id===value} className={o.id===value?'on':''} onClick={()=>onChange(o.id)}>{o.label}</button>)}</div>;
}
