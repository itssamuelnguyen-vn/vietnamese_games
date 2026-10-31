import type { ChessEndReason, ErrorCode, GameType } from '@vg/shared';

// Vietnamese UI strings. This is the only place user-facing text should live;
// a new locale is a copy of this object with the same shape.
export const vi = {
  appName: 'Sân Chơi',
  connected: 'Đã kết nối',
  connecting: 'Đang kết nối…',

  games: {
    chess: 'Cờ vua',
    xiangqi: 'Cờ tướng',
    tienlen: 'Tiến lên miền Nam',
    typhu: 'Cờ tỉ phú',
  } satisfies Record<GameType, string>,
  playerCount: (min: number, max: number) => (min === max ? `${min} người` : `${min}–${max} người`),

  lobby: {
    yourName: 'Tên của bạn',
    namePlaceholder: 'Vd. Minh',
    joinExisting: 'Vào phòng có sẵn',
    codePlaceholder: 'MÃ',
    join: 'Vào phòng',
    createNew: 'Tạo phòng mới',
    create: 'Tạo phòng',
    comingSoon: 'Sắp có',
  },

  room: {
    copyLink: 'Chép link',
    copied: 'Đã chép',
    players: (count: number, max: number) => `Người chơi (${count}/${max})`,
    you: '(bạn)',
    host: 'Chủ phòng',
    online: 'Online',
    offline: 'Mất kết nối',
    start: 'Bắt đầu',
    playAgain: 'Chơi ván mới',
    waitingForHost: 'Chờ chủ phòng bắt đầu…',
    inviteHint: 'Gửi mã phòng hoặc link cho bạn bè để cùng chơi.',
    leave: 'Rời phòng',
    confirmLeaveMidGame: 'Rời phòng giữa ván sẽ bị tính là thua. Rời phòng?',
    boardPlaceholder: 'Bàn chơi sẽ hiện khi ván bắt đầu',
  },

  chess: {
    endReasons: {
      checkmate: 'chiếu hết',
      stalemate: 'hết nước đi',
      threefold: 'lặp lại 3 lần',
      insufficient: 'không đủ quân chiếu hết',
      'fifty-moves': 'luật 50 nước',
      resign: 'đối thủ xin thua',
    } satisfies Record<ChessEndReason, string>,
    youResigned: 'bạn xin thua',
    youWin: (reason: string) => `Bạn thắng (${reason})`,
    playerWins: (name: string, reason: string) => `${name} thắng (${reason})`,
    draw: (reason: string) => `Hòa (${reason})`,
    whiteToMove: 'Lượt Trắng',
    blackToMove: 'Lượt Đen',
    yourTurn: 'Lượt của bạn',
    turnOf: (name: string) => `Lượt của ${name}`,
    opponent: 'Đối thủ',
    check: ' · Chiếu!',
    youLabel: (name: string) => `${name} (bạn)`,
    resign: 'Xin thua',
    confirmResign: 'Bạn chắc chắn muốn xin thua?',
  },

  errors: {
    GAME_UNAVAILABLE: 'Game này chưa sẵn sàng',
    NAME_REQUIRED: 'Hãy nhập tên trước đã',
    ROOM_NOT_FOUND: 'Không tìm thấy phòng',
    ROOM_IN_GAME: 'Phòng đang chơi',
    ROOM_FULL: 'Phòng đã đủ người',
    NOT_IN_ROOM: 'Bạn chưa vào phòng',
    NOT_HOST: 'Chỉ chủ phòng mới được bắt đầu',
    GAME_IN_PROGRESS: 'Ván đang diễn ra',
    NOT_ENOUGH_PLAYERS: 'Chưa đủ người chơi',
    GAME_NOT_STARTED: 'Ván chưa bắt đầu',
    GAME_OVER: 'Ván đã kết thúc',
    NOT_A_PLAYER: 'Bạn không phải người chơi',
    NOT_YOUR_TURN: 'Chưa đến lượt bạn',
    INVALID_MOVE: 'Nước đi không hợp lệ',
    DISCONNECTED: 'Mất kết nối tới server',
  } satisfies Record<ErrorCode, string>,
};

export type Strings = typeof vi;
