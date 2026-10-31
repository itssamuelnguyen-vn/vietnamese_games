import type { ChessEndReason, ErrorCode, GameType } from '@vg/shared';

// Vietnamese UI strings. This is the only place user-facing text should live;
// a new locale is a copy of this object with the same shape.
export const vi = {
  appName: 'Sân Chơi',
  connected: 'Trực tuyến',
  connecting: 'Đang kết nối…',
  footer: 'Làm cho vui, chơi cho vui.',

  games: {
    chess: 'Cờ vua',
    xiangqi: 'Cờ tướng',
    tienlen: 'Tiến lên miền Nam',
    typhu: 'Cờ tỉ phú',
  } satisfies Record<GameType, string>,
  gameBlurbs: {
    chess: 'Đấu trí kinh điển trên 64 ô cờ.',
    xiangqi: 'Xe, pháo, mã đối đầu hai bên bờ sông.',
    tienlen: '13 lá bài, ai đánh hết trước thì thắng.',
    typhu: 'Gieo xúc xắc, mua đất, xây nhà, thu tiền.',
  } satisfies Record<GameType, string>,
  playerCount: (min: number, max: number) => (min === max ? `${min} người` : `${min}–${max} người`),

  hero: {
    kicker: 'Cờ & bài online',
    title: 'Rủ bạn bè vào chơi,',
    titleAccent: 'chỉ cần một đường link.',
    subtitle: 'Không cài đặt, không đăng ký. Tạo phòng, gửi link, chơi ngay trên điện thoại hay máy tính.',
  },

  lobby: {
    yourName: 'Bạn tên gì?',
    namePlaceholder: 'Nhập tên để bắt đầu',
    nameHint: 'Tên này sẽ hiện với người chơi khác.',
    joinTitle: 'Có mã phòng?',
    joinSubtitle: 'Nhập mã 4 ký tự bạn bè gửi cho bạn.',
    join: 'Vào phòng',
    chooseGame: 'Chọn trò chơi',
    chooseGameSubtitle: 'Tạo phòng mới rồi mời bạn bè vào cùng.',
    create: 'Tạo phòng',
    comingSoon: 'Sắp ra mắt',
    stepsTitle: 'Chơi trong 3 bước',
    steps: [
      { title: 'Tạo phòng', text: 'Chọn trò chơi, bạn sẽ nhận được mã phòng.' },
      { title: 'Gửi link', text: 'Chia sẻ link mời qua Messenger, Zalo hay bất cứ đâu.' },
      { title: 'Cùng chơi', text: 'Bạn bè bấm link là vào thẳng phòng, không cần tài khoản.' },
    ],
  },

  room: {
    codeLabel: 'Mã phòng',
    copyLink: 'Chép link mời',
    linkCopied: 'Đã chép link mời',
    share: 'Chia sẻ',
    shareText: (game: string) => `Vào chơi ${game} với mình nhé!`,
    waitingTitle: 'Phòng chờ',
    players: (count: number, max: number) => `${count}/${max} người chơi`,
    emptySeat: 'Đang chờ…',
    you: 'Bạn',
    host: 'Chủ phòng',
    offline: 'Mất kết nối',
    start: 'Bắt đầu',
    playAgain: 'Chơi ván mới',
    waitingForHost: 'Chờ chủ phòng bắt đầu…',
    needMore: (n: number) => `Cần thêm ${n} người nữa. Gửi link mời cho bạn bè nhé!`,
    ready: 'Đủ người rồi, bắt đầu thôi!',
    leave: 'Rời phòng',
    confirmLeaveMidGame: 'Rời phòng giữa ván sẽ bị tính là thua. Rời phòng?',
  },

  chess: {
    endReasons: {
      checkmate: 'Chiếu hết',
      stalemate: 'Hết nước đi',
      threefold: 'Lặp lại 3 lần',
      insufficient: 'Không đủ quân chiếu hết',
      'fifty-moves': 'Luật 50 nước',
      resign: 'Đối thủ xin thua',
    } satisfies Record<ChessEndReason, string>,
    youResigned: 'Bạn đã xin thua',
    resultWin: 'Bạn thắng!',
    resultLose: 'Bạn thua rồi',
    resultDraw: 'Hòa cờ',
    playerWins: (name: string) => `${name} thắng`,
    reviewBoard: 'Xem lại bàn cờ',
    whiteToMove: 'Lượt Trắng',
    blackToMove: 'Lượt Đen',
    yourTurn: 'Đến lượt bạn',
    turnOf: (name: string) => `${name} đang nghĩ…`,
    opponent: 'Đối thủ',
    check: 'Chiếu!',
    moves: 'Nước đi',
    noMoves: 'Trắng đi trước. Chúc may mắn!',
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
