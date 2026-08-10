import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { User, UserRole } from './user.entity';
import { UsersService } from './users.service';

type AuthRequest = Request & { user: { userId: string } };

@Controller('admin/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.findAll();
  }

  @Post()
  create(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      cpf: string;
      mobilePhone: string;
      roles?: UserRole[];
    },
  ) {
    return this.users.create(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      cpf?: string;
      mobilePhone?: string;
      active?: boolean;
      password?: string;
    },
  ) {
    return this.users.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthRequest) {
    return this.users.remove(id, req.user.userId);
  }
}
