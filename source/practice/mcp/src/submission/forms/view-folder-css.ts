// The folder look shared by the view pages that file their sections in one tabbed folder (the
// Arguments and Loose Threads pages): skeuomorphic tabs over one panel, and the section headings
// inside it. Each page adds its own cards, tags and controls after it.

export const VIEW_FOLDER_CSS = String.raw`
.board{gap:0}
.tabs{display:flex;align-items:flex-end;padding:0 10px;position:relative}
.tabs [role=tab]{position:relative;z-index:1;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:inherit;font-size:13px;font-weight:600;color:#3d5c50;background:none;border:0;padding:7px 18px 6px;margin-left:-6px;cursor:pointer}
.tabs [role=tab]:first-child{margin-left:0}
.tabs [role=tab]::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(#c4dacd,#aecaba);border:1px solid #8fb3a0;border-bottom:0;border-radius:9px 9px 0 0;box-shadow:inset 0 -4px 5px -3px rgba(0,0,0,.22);transform:perspective(10px) rotateX(1.6deg);transform-origin:bottom}
.tabs [role=tab][aria-selected=true]{z-index:3;padding-top:10px;padding-bottom:8px;margin-bottom:-1px;color:#1d5e4a;font-weight:800}
.tabs [role=tab][aria-selected=true]::before{background:linear-gradient(#eaf5ee,#cfe6d8);box-shadow:none}
.tabs [role=tab]:focus-visible{outline:2px solid #1d5e4a;outline-offset:-5px}
.folder{position:relative;z-index:2;background:#cfe6d8;border:1px solid #8fb3a0;border-radius:0 12px 12px 12px;padding:18px;display:flex;flex-direction:column;gap:28px}
.folder section{background:none;padding:0;border-radius:0}
.folder section>h2{font-size:22px;font-weight:800;color:#1d5e4a;border-bottom:2px solid #1d5e4a;align-items:center;flex-wrap:wrap;gap:10px}
.folder>p.empty{margin:0;font-size:13px;color:var(--muted);background:var(--card);padding:12px 14px;border:1px dashed var(--frame);border-radius:8px}
[hidden]{display:none!important}
@media (max-width:600px){main{padding:16px}}
@media (max-width:520px){
.tabs{padding:0 4px}
.tabs [role=tab]{font-size:11.5px;padding:6px 9px 5px}
.tabs [role=tab][aria-selected=true]{padding-top:8px;padding-bottom:7px}
.folder{padding:12px}
}
`;
