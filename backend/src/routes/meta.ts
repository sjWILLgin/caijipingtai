import { Router, Request, Response } from 'express';
import { errorResponse, successResponse } from '../utils';
import { ensureDomainTable, createDomain, listDomains, updateDomain } from '../services/domainService';

const router = Router();

type AuthUser = {
  userId: number;
  username: string;
  roleKey: 'super_admin' | 'domain_admin' | 'analyst';
};

router.get('/domains', async (req: Request, res: Response) => {
  try {
    await ensureDomainTable();
    const authUser = (req as any).authUser as AuthUser;
    const includeInactive = String(req.query.include_inactive || '0') === '1' && authUser?.roleKey === 'super_admin';
    const rows = await listDomains(includeInactive);
    return res.json(successResponse(rows));
  } catch (err: any) {
    return res.status(500).json(errorResponse(err.message || '获取业务域失败'));
  }
});

router.post('/domains', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    if (!authUser || authUser.roleKey !== 'super_admin') {
      return res.status(403).json(errorResponse('仅超级管理员可维护业务域'));
    }

    await createDomain({
      domain_name: req.body?.domain_name,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
      remark: req.body?.remark,
    });
    return res.json(successResponse(true, '业务域已新增'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '新增业务域失败'));
  }
});

router.put('/domains/:id', async (req: Request, res: Response) => {
  try {
    const authUser = (req as any).authUser as AuthUser;
    if (!authUser || authUser.roleKey !== 'super_admin') {
      return res.status(403).json(errorResponse('仅超级管理员可维护业务域'));
    }

    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json(errorResponse('业务域ID无效'));
    }

    await updateDomain(id, {
      domain_name: req.body?.domain_name,
      is_active: req.body?.is_active,
      sort_order: req.body?.sort_order,
      remark: req.body?.remark,
    });
    return res.json(successResponse(true, '业务域已更新'));
  } catch (err: any) {
    return res.status(400).json(errorResponse(err.message || '更新业务域失败'));
  }
});

export default router;
