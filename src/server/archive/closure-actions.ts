'use server';
import {z} from 'zod';import {prisma} from '@/lib/prisma';import {requireSession} from '@/lib/auth/session';import {scopeFor,hasCustomPermission} from '@/lib/roles/catalog';import {matterAssociationFilter} from '@/lib/permissions';import {approvalTransaction} from '@/lib/approvals/service';import {revalidatePath} from 'next/cache';import {closureReady,closureFacts,closureInput,saveClosureTx} from './closure';
export async function getClosureBoard(matterId:string){
 const session=await requireSession('archive.read');
 if(!await closureReady(prisma))return null;
 const matter=await prisma.matter.findFirst({where:{id:matterId,deletedAt:null,...matterAssociationFilter(session.user.id)},select:{status:true}});if(!matter)return null;
 const facts=await closureFacts(prisma,matterId);
 const [plan]=await prisma.$queryRaw<{financeOwnerId:string|null;name:string|null;serviceCompletedAt:Date;reason:string;revision:number;fingerprint:string}[]>`SELECT p.*,u.name FROM "ArchiveClosurePlan" p LEFT JOIN "User" u ON u.id=p."financeOwnerId" WHERE p."matterId"=${matterId}`;
 const people=await prisma.user.findMany({where:{active:true,role:'CUSTOM',roleDefinition:{active:true,permissions:{some:{permissionKey:'finance.tail',scope:'ALL'}}}},select:{id:true,name:true}});
 const archives=await prisma.archiveRecord.findMany({where:{matterId},orderBy:{archivedAt:'asc'},select:{id:true,archiveNo:true,status:true,summary:true}});
 return {status:matter.status,blockers:facts.blockers,financeOpen:facts.financeOpen,finance:hasCustomPermission(session.user,'finance.read')?facts.financeSnapshot:null,plan:plan?{financeOwnerId:plan.financeOwnerId,name:plan.name,serviceCompletedAt:plan.serviceCompletedAt,reason:plan.reason,revision:plan.revision,current:plan.fingerprint===facts.fingerprint}:null,people,archives,canSave:hasCustomPermission(session.user,'archive.submit'),canSupplement:scopeFor(session.user,'archive.supplement')==='OWN'&&hasCustomPermission(session.user,'archive.submit')};
}
export async function saveClosure(input:z.input<typeof closureInput>){const session=await requireSession('archive.submit');const result=await approvalTransaction(db=>saveClosureTx(db,session.user.id,input));revalidatePath('/matters/[id]','page');revalidatePath('/approvals');return result;}
