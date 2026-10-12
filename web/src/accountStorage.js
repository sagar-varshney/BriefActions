// Hosted browser drafts never reuse the local workspace or another account's keys.
let account=null;
export function scopeStorage(id){account=id;}
const key=name=>account?`flow.account.${account}.${name}`:name;
export default {
  getItem:name=>localStorage.getItem(key(name)),
  setItem:(name,value)=>localStorage.setItem(key(name),value),
  removeItem:name=>localStorage.removeItem(key(name)),
};
