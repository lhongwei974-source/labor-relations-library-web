export const categories=['变量构建','异质性分类','回归方法','机制变量','理论借鉴','其他'];
export function cleanIdeaTags(input){
  if(!Array.isArray(input))return [];
  return [...new Set(input.map(value=>String(value??'').trim().slice(0,32)).filter(Boolean))].slice(0,12);
}
