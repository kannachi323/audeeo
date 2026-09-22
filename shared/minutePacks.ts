export const minutePacks = [
  {id:'minutes_60', minutes:60, apple:'audeeo_minutes_60', web:'audeeo_minutes_60_web'},
  {id:'minutes_180', minutes:180, apple:'audeeo_minutes_180', web:'audeeo_minutes_180_web'},
  {id:'minutes_600', minutes:600, apple:'audeeo_minutes_600', web:'audeeo_minutes_600_web'},
] as const;
export type MinutePackId = typeof minutePacks[number]['id'];
export type MinutePackOffer = {id:MinutePackId; minutes:number; price:string; productID:string; pricesByQuantity?:string[]};
export const isMinutePackProduct = (id:unknown): id is string => typeof id==='string' && minutePacks.some(p=>p.apple===id || p.web===id);
export type SessionBillingOptions = {voiceEnabled:boolean; allowPurchasedMinutes:boolean};

export type PackPurchaseResult = {status:'cancelled'|'external'} | {status:'pending';transactionId:string;productID:string; pricesByQuantity?:string[]};
export type PackPurchaseStatus = {status:'pending'|'confirmed'|'refunded';environment?:'PRODUCTION'|'SANDBOX'};

/** Soniox TTS languages used by Audeeo's target-language menu. */
export const spokenTranslationSupported=(source:string,target:string)=>source!==target && !(['zh','zh-cn','cmn','zh-tw','zh-hk'].includes(source)&&['zh','zh-cn'].includes(target)) && ['es','pt','fr','ja','ru','zh','zh-cn','de','ko','hi','id','vi','it','en'].includes(target);
