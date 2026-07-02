(function(){'use strict';
 const SESSION_KEY='somap.volunteerSession';
 const text=v=>String(v==null?'':v).trim();
 function normalizeName(value){return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()}
 function nameTokens(value){return [...new Set(normalizeName(value).split(' ').filter(x=>x.length>1))]}
 function normalizePhone(raw,code){let value=text(raw).replace(/[^\d+]/g,'');let cc=text(code).replace(/\D/g,'');if(!value)return'';if(value.startsWith('+'))return '+'+value.slice(1).replace(/\D/g,'');value=value.replace(/\D/g,'');if(value.startsWith('00'))return'+'+value.slice(2);if(cc&&value.startsWith(cc))return'+'+value;if(value.startsWith('0'))value=value.slice(1);return cc?'+'+cc+value:'+'+value}
 function year(){return String(window.somapYearContext?.getSelectedYear?.()||localStorage.getItem('somapSelectedYear')||new Date().getFullYear())}
 function school(){return window.SOMAP?.getSchool?.()||{id:localStorage.getItem('somap.currentSchoolId')||'socrates-school',name:'School'}}
 function path(part,y=year()){return window.SOMAP?.P?window.SOMAP.P(`years/${y}/${part}`):`years/${y}/${part}`}
 function ref(part,y){if(!window.firebase)throw Error('Firebase unavailable');return firebase.database().ref(path(part,y))}
 function recordTokens(v){return [...new Set([v.firstName,v.middleName,v.lastName,v.otherName].flatMap(nameTokens))]}
 function hasTwoNames(input,v){const entered=nameTokens(input),registered=new Set(v.normalizedNameTokens||recordTokens(v));return entered.length>=2&&entered.filter(x=>registered.has(x)).length>=2}
 function saveSession(v,y){const s=school();const session={role:'volunteer',volunteerId:v.volunteerId,displayName:v.displayName,schoolId:s.id,schoolName:v.schoolName||s.name||s.id,year:String(y),accessLevel:Number(v.accessLevel||1),status:v.status};localStorage.setItem('role','volunteer');sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));localStorage.setItem(SESSION_KEY,JSON.stringify(session));return session}
 function getSession(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY)||'null')}catch(_){return null}}
 function requireSession(){const s=getSession();if(!s||s.role!=='volunteer'){location.replace('../login.html');throw Error('Volunteer session required')}return s}
 function escapeHtml(v){return text(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
 window.SomapVolunteers={SESSION_KEY,normalizeName,nameTokens,normalizePhone,year,school,path,ref,recordTokens,hasTwoNames,saveSession,getSession,requireSession,escapeHtml};
})();
