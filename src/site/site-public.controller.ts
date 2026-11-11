import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SitePublicService } from './site-public.service';

@ApiTags('Public · Site')
@Controller('public/site')
export class SitePublicController {
  constructor(private readonly site: SitePublicService) {}

  @Post('contact')
  submitContact(
    @Body()
    body: {
      profile?: string;
      name?: string;
      email?: string;
      organization?: string;
      phone?: string;
      botField?: string;
    },
    @Req() req: Request,
  ) {
    this.site.assertContactSecret(req);
    return this.site.submitContact(body, req);
  }
}
