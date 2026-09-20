'use server';
import {z} from 'zod';
import {requireSession} from '@/lib/auth/session';
import {approvalTransaction} from '@/lib/approvals/service';
import {revalidateMatter} from '@/server/matters/route';
import {runMatterReviewTx,decideMatterReviewTx} from './matter-review';
export async function runMatterReview(matterId:string){const session=await requireSession('matters.write');await approvalTransaction(db=>runMatterReviewTx(db,session.user.id,z.string().cuid().parse(matterId)));await revalidateMatter(matterId);return {ok:true};}
export async function decideMatterReview(input:{matterId:string;checkId:string;conclusion:'DIFFERENT'|'SAME_SUBJECT'|'NEED_INFO';note:string}){const session=await requireSession('matters.write');const d=z.object({matterId:z.string().cuid(),checkId:z.string().cuid(),conclusion:z.enum(['DIFFERENT','SAME_SUBJECT','NEED_INFO']),note:z.string().trim().min(1).max(2000)}).parse(input);await approvalTransaction(db=>decideMatterReviewTx(db,session.user.id,d.matterId,d.checkId,d.conclusion,d.note));await revalidateMatter(d.matterId);return {ok:true};}
