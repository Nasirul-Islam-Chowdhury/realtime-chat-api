import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './create-room.dto';
import { SendMessageDto } from './send-message.dto';
import { AuthGuard } from '../common/guards/auth.guard';
import type { Request } from 'express';

@Controller('api/v1/rooms')
@UseGuards(AuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Get()
  async findAll() {
    const rooms = await this.roomsService.findAll();
    return { rooms };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateRoomDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.roomsService.create(dto.name, user.username);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    await this.roomsService.remove(id, user.username);
    return { deleted: true };
  }

  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.roomsService.getMessages(id, parseInt(limit ?? '50', 10), before);
  }

  @Post(':id/messages')
  @HttpCode(201)
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.roomsService.sendMessage(id, user.username, dto.content);
  }
}
