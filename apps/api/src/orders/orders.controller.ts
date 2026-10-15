import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { ORDER_STATUSES } from '@cullinari/shared';
import { Auth, AuthContext, scopeBranch } from '../auth/auth.context';
import { parse } from '../common/validate';
import { OrdersService } from './orders.service';

const listQuery = z.object({
  view: z.enum(['active', 'history']).default('active'),
  branchId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Every role can see the order queue; who can move an order where is checked per status. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query() query: unknown) {
    const q = parse(listQuery, query);
    return this.orders.list(auth, { ...q, branchId: scopeBranch(auth, q.branchId) });
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(auth, id);
  }

  @Patch(':id/status')
  status(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(
      z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().trim().max(300).optional() }),
      body,
    );
    return this.orders.transition(auth, id, input.status, input.reason);
  }
}
