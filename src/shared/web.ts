import { z } from 'zod'

export const WEB_HIT_SOURCES=['bing','duckduckgo','brave','tavily','exa','serper','semantic_scholar','arxiv','pubmed','crossref','openalex'] as const
export type WebHitSource=typeof WEB_HIT_SOURCES[number]
export interface WebHit { title:string;url:string;snippet:string;source:WebHitSource;doi?:string;year?:number;authors?:string;pdfUrl?:string;citations?:number;excerpt?:string }
export interface WebSearchResult { hits:WebHit[];sources:string[];errors:Array<{source:string;message:string}> }
/** List view of a stored snapshot (without the markdown body). */
export interface WebSnapshotInfo { id:number;url:string;finalUrl:string;title:string;excerpt:string;kind:'html'|'pdf';fetchedAt:string;contentHash:string;bytes:number }
/** A read web page as returned to the renderer (temp file paths stay in the main process). */
export interface WebPageInfo { url:string;finalUrl:string;title:string;byline:string;excerpt:string;language:string;siteName:string;markdown:string;chars:number;contentHash:string;fetchedAt:string;contentType:string;kind:'html'|'pdf';fromCache:boolean;doi?:string;pdfUrl?:string;publishedAt?:string }

export const webContextSnippetSchema=z.object({url:z.string().url()}).passthrough()
