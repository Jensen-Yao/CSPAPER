import { createCompare, generateCells, listCompare, saveCompare, type CompareData, type CompareTable } from './insight'

export type { CompareData, CompareTable }

const cleanPaperIds=(paperIds:number[])=>{
  const ids=[...new Set(paperIds)].map(Number)
  if(ids.length<2||ids.length>50||ids.some(id=>!Number.isInteger(id)||id<=0))throw new Error('对比表需要 2-50 个不同的有效文献 ID')
  return ids
}
const cleanDimensions=(dimensions:string[])=>{
  const values=dimensions.map(dimension=>dimension.trim()).filter(Boolean)
  if(values.length<1||values.length>12||values.some(dimension=>dimension.length>100))throw new Error('对比表需要 1-12 个非空维度')
  return values
}
async function writeComparison(table:CompareTable,paperIds:number[],dimensions:string[],generateIds:number[]) {
  const existing=listCompare().find(row=>row.id===table.id)?.data
  const cells=existing?.cells??{},fields=existing?.fields??['作者','期刊名称']
  for(const paperId of generateIds) {
    const generated=await generateCells(paperId,dimensions,()=>{})
    cells[String(paperId)]={...(cells[String(paperId)]??{}),...generated}
  }
  const data:CompareData={paperIds,dimensions,fields,cells}
  saveCompare(table.id,data)
  return {...table,data}
}

/** Shared application service used by renderer IPC and model tools. */
export async function createComparison(paperIds:number[],dimensions:string[]=['研究方法','数据与实验','核心结论']) {
  const ids=cleanPaperIds(paperIds),values=cleanDimensions(dimensions),table=await createCompare()
  return writeComparison(table,ids,values,ids)
}
export async function updateComparison(id:number,paperIds:number[],dimensions:string[],generateIds?:number[]) {
  const table=listCompare().find(row=>row.id===id)
  if(!table)throw new Error(`对比表 #${id} 不存在`)
  const ids=cleanPaperIds(paperIds),values=cleanDimensions(dimensions)
  const selected=new Set(generateIds??ids)
  return writeComparison(table,ids,values,ids.filter(id=>selected.has(id)))
}
