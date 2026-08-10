"use client";

import { useLayoutEffect } from "react";
import { useLocale } from "@/front_end/state/locale-context";

// This dictionary is intentionally central rather than scattered through each
// page. It translates both existing and future-mounted modal/dashboard text,
// while keeping proper nouns such as ECHO unchanged. New user-generated text
// (persona names, questions, messages) is never altered.
const zh: Record<string, string> = {
  "Home": "首页", "Pricing": "价格", "About Us": "关于我们", "FAQ": "常见问题", "Dashboard": "控制台", "Register": "注册", "Account settings": "账户设置", "Toggle menu": "切换菜单",
  "Frequently asked questions.": "常见问题", "Support": "支持", "Further Questions?": "还有其他问题？", "We're here to help.": "我们随时为您提供帮助。", "Your name": "您的姓名", "Your question": "您的问题", "Up to 50 characters": "最多 50 个字符", "Up to 500 characters": "最多 500 个字符", "Send question": "提交问题", "Sending…": "正在发送…",
  "What is ECHO 回响?": "什么是 ECHO 回响？", "Who can see my personas and uploads?": "谁可以查看我的人格与上传内容？", "What can I upload to a persona?": "我可以向人格上传什么？", "Can I change or delete files later?": "之后可以修改或删除文件吗？", "How do subscriptions work?": "订阅如何运作？", "How do I get help with my account?": "如何获得账户帮助？",
  "ECHO 回响 is a space to collect the memories, voice, and context that help make a persona feel personal. You choose what to add and can update it over time.": "ECHO 回响让您收集记忆、声音与背景信息，从而塑造专属人格。您可以自行决定添加什么内容，并随时更新。",
  "Your personas, conversations, and uploaded materials are tied to your own account. They are not shown to other accounts.": "您的人格、对话及上传材料均仅关联您的账户，不会向其他账户展示。",
  "You can add supported documents, photos, audio, video, and account links. Some media features and higher limits require an active subscription.": "您可以添加受支持的文档、照片、音频、视频和账户链接。部分媒体功能及更高额度需要有效订阅。",
  "Yes. Open the persona menu from your dashboard to review uploads, sort them, add more, or permanently delete individual files.": "可以。请在控制台打开人格菜单，查看、排序、添加或永久删除单个上传文件。",
  "An active subscription unlocks additional persona capacity and media tools. Your current access is shown in Account Settings.": "有效订阅可解锁更多人格容量与媒体工具。您当前的权限会显示在账户设置中。",
  "Use the form below while signed in. The support team receives your account details with the question so they can help efficiently.": "登录后使用下方表单。支持团队会随问题收到您的账户信息，以便更高效地提供帮助。",
  "Create AI personas of real people from photos, video, audio, chat history, and social media — then talk to them by text or real-time voice and video.": "通过照片、视频、音频、聊天记录和社交媒体创建真实人物的 AI 人格，并通过文字或实时语音和视频与他们交流。",
  "Bring someone back into the conversation — create their AI persona from photos, video, audio, chat history, and social media.": "让某人重回对话之中——通过照片、视频、音频、聊天记录和社交媒体创建他们的 AI 人格。",
  "Get Started": "开始使用", "See Pricing": "查看价格", "How it works": "使用方式", "From memories to a conversation": "从记忆到一段对话", "Upload their media": "上传他们的资料", "We learn who they are": "我们了解他们是谁", "Talk to their persona": "与他们的人格交流",
  "Photos, videos, audio, chat exports, and social links — as much or as little as you have.": "照片、视频、音频、聊天导出内容和社交链接——您拥有多少都可以添加。", "ECHO studies their voice, face, and personality from what you upload.": "ECHO 会从您上传的内容中学习他们的声音、面容与个性。", "Chat by text, or step into a live voice and video conversation.": "您可以文字聊天，或进入实时语音和视频对话。",
  "What ECHO learns from": "ECHO 学习的来源", "Every kind of memory": "每一种记忆", "Photos": "照片", "Chat history": "聊天记录", "Documents": "文档", "Video": "视频", "Audio": "音频", "Live facial scan": "实时面部扫描", "Guided facial scan": "引导式面部扫描", "Passive facial scan": "自然动态面部扫描", "Free": "免费版", "Subscriber": "订阅用户", "Text conversations with your persona, whenever you want to talk.": "随时与您的人格进行文字对话。", "Everything in Free, plus real-time voice and video conversation.": "包含免费版所有功能，并提供实时语音和视频对话。",
  "Placeholder content": "示例内容", "Loved by early users": "早期用户的喜爱", "personas created": "已创建人格", "messages exchanged": "已交换消息", "registered users": "注册用户", "Keep the conversation going": "让对话持续下去", "Create your first persona in minutes — free to start.": "几分钟内创建您的第一个人格——免费开始。",
  "One conversation, three ways to keep it going": "一段对话，三种延续方式", "Start free with text. Purchase a plan for real-time voice and video.": "可免费开始文字对话。购买套餐即可使用实时语音和视频。", "Every plan is a one-time purchase, not a recurring subscription — it never auto-renews or charges you again. Purchasing more time while a plan is still active simply adds to it and pushes out your expiry date.": "每个套餐均为一次性购买，并非自动续订订阅——不会自动续费或再次扣款。在套餐有效期内购买更多时长，只会叠加时长并延后到期日期。",
  "Log in to continue": "登录以继续", "Create your account": "创建您的账户", "Email or username": "邮箱或用户名", "Username": "用户名", "Email": "邮箱", "Password": "密码", "Confirm your email": "确认您的邮箱", "You're not logged in.": "您尚未登录。", "Change password": "修改密码", "Current password": "当前密码", "New password": "新密码", "Update password": "更新密码", "Profile picture": "头像", "Choose image": "选择图片", "Save": "保存", "Subscription": "订阅", "Appearance": "外观", "Cancel": "取消", "Close": "关闭", "Menu": "菜单",
  "Personas": "人格", "No personas yet": "尚未创建人格", "Create +": "创建 +", "Order Teddy": "订购 Teddy", "Return Home": "返回首页", "Select or create a persona to get started": "选择或创建一个人格以开始", "View progress": "查看进度", "Loading…": "加载中…", "Connecting…": "正在连接…", "Add more files": "添加更多文件", "Media": "媒体", "Text & Links": "文字与链接", "Audio upload": "上传音频", "Video recorder": "视频录制", "Audio recorder": "音频录制", "Social media links": "社交媒体链接", "Name your persona": "为您的人格命名", "Add what you have": "添加您拥有的内容", "Done": "完成", "Delete": "删除", "Delete persona": "删除人格", "Loading uploads…": "正在加载上传内容…", "No files have been uploaded yet.": "尚未上传文件。", "Order:": "排序：", "Name": "名称", "Date": "日期",
  "One voice recording per persona — re-recording replaces it": "每个人格一段语音录音——重新录制会替换原录音", "One facial scan per persona — re-scanning replaces it": "每个人格一次面部扫描——重新扫描会替换原扫描", "One facial scan and motion clip per persona — re-scanning replaces them": "每个人格一次面部扫描及动态片段——重新扫描会替换它们", "Up to 3 camera videos, 15 seconds each": "最多 3 段相机视频，每段 15 秒", "Requires a subscription": "需要订阅", "Go Back": "返回", "A physical companion for your persona — coming in a later phase.": "人格的实体陪伴伙伴——将在后续阶段推出。",
  "Our mission": "我们的使命", "Nobody should lose the chance to say one more thing": "每个人都不该失去再说一句话的机会", "ECHO 回响 exists so a voice, a face, and a way of speaking don't have to disappear completely. We help people build a persona from what someone left behind — photos, messages, recordings — and keep a conversation open.": "ECHO 回响希望让声音、面容和说话方式不必完全消失。我们帮助人们从某人留下的照片、消息与录音中建立人格，让对话继续。",
  "Handled responsibly": "负责任地处理", "A likeness deserves real care": "肖像值得被认真守护", "Photos, voice, and video are about as personal as data gets. Here's how we think about handling it.": "照片、声音和视频是极其私密的数据。以下是我们处理它们的原则。", "You control what's uploaded": "上传内容由您掌控", "Every photo, recording, and message is added deliberately, asset by asset, and can be removed at any time.": "每张照片、每段录音和每条消息都由您逐项主动添加，并可随时移除。", "Likenesses stay private by default": "肖像默认保持私密", "Personas are visible only to the account that created them — never public, never used to train models for other users.": "人格仅对创建它们的账户可见——绝不公开，也绝不用于训练其他用户的模型。", "Deletion means deletion": "删除即彻底删除", "Removing a persona removes its underlying media and derived data, not just the chat interface.": "删除人格会移除其底层媒体和衍生数据，而不仅是聊天界面。", "Sensitive by design": "从设计开始保护敏感数据", "Faces, voices, and video are handled as sensitive personal data throughout the product, not just in the fine print.": "在整个产品中，面容、声音和视频都被视为敏感个人数据处理，而不仅仅写在细则中。",
  "Our team": "我们的团队", "The people building ECHO": "正在打造 ECHO 的人", "Founder & CEO": "创始人兼首席执行官", "Head of Engineering": "工程负责人", "Head of Trust & Safety": "信任与安全负责人", "Ready to start the conversation?": "准备开始这段对话了吗？", "Create a persona in minutes, or see what's included in each plan.": "几分钟内即可创建人格，或查看每个套餐包含的内容。",
  "Accepted payment methods": "支持的付款方式", "Current plan": "当前套餐", "Purchase": "购买", "Credit or debit card": "信用卡或借记卡", "Continue": "继续", "Card number": "卡号", "Name on card": "持卡人姓名", "Billing address": "账单地址", "Review order": "核对订单", "QR code placeholder": "二维码占位符", "I've completed payment": "我已完成付款", "Plan:": "套餐：", "Price:": "价格：", "Payment method:": "付款方式：", "One-time purchase, not a recurring subscription — this won't auto-renew or charge you again. If you already have time remaining, this adds to it.": "一次性购买，并非自动续订订阅——不会自动续费或再次扣款。如果您仍有剩余时长，本次购买会叠加到现有时长。", "Confirming…": "正在确认…", "Confirm purchase": "确认购买", "Welcome aboard.": "欢迎加入。", "Try again": "重试",
  "Confirm your password change": "确认修改密码", "Enter the six-character code we emailed you to confirm this change.": "请输入我们发送到您邮箱的六码验证码以确认此修改。", "Send a new code": "发送新的验证码", "Password changed.": "密码已修改。", "Choose a PNG, JPG, or JPEG image.": "请选择 PNG、JPG 或 JPEG 图片。", "Profile picture must be 1MB or smaller.": "头像必须小于或等于 1MB。", "Uploading…": "正在上传…", "Profile picture updated.": "头像已更新。", "Light": "浅色", "Dark": "深色", "System": "跟随系统",
  "Log in": "登录", "Logging in…": "正在登录…", "Register now": "立即注册", "Already have an account? Log in": "已有账户？登录", "Sending code…": "正在发送验证码…", "Message": "消息", "Voice input": "语音输入", "Close dashboard menu": "关闭控制台菜单", "Turn video off": "关闭视频", "Turn video on": "开启视频", "Live video is off.": "实时视频已关闭。", "Loading your dashboard…": "正在加载控制台…", "Drag chat window": "拖动聊天窗口", "Minimize chat": "最小化聊天", "Expand chat": "展开聊天", "Real-time voice and video conversation is a subscriber feature.": "实时语音和视频对话为订阅用户专属功能。", "Upgrade": "升级", "Hearing you…": "正在聆听…", "Transcribing…": "正在转写…", "Listening — pause when you're done talking.": "正在聆听——说完后请稍作停顿。", "Lost the connection to the avatar server.": "与虚拟形象服务器的连接已断开。", "Couldn't establish a secure media relay. Please retry.": "无法建立安全的媒体中继。请重试。", "Couldn't establish a direct or relay media path. Please retry.": "无法建立直连或中继媒体通道。请重试。", "Couldn't reach the avatar server in time.": "无法及时连接虚拟形象服务器。", "Couldn't connect to the avatar server.": "无法连接虚拟形象服务器。", "Connection failed.": "连接失败。", "Retry": "重试", "No trained likeness yet — showing a placeholder avatar. Add a video or facial scan to train this persona's own.": "尚未训练出专属形象——正在显示占位虚拟形象。请添加视频或面部扫描以训练此人格的专属形象。",
  "Creating…": "正在创建…", "e.g. Grandma Rose": "例如：Rose 奶奶", "Upload as much or as little as you like — you can always add more later.": "您可以按需上传，并且之后随时可以继续添加。", "Record voice": "录制声音", "Start recording": "开始录制", "Start scan": "开始扫描", "Start facial scan": "开始面部扫描", "Start guided scan": "开始引导式扫描", "Start passive scan": "开始自然动态扫描", "Stop & save": "停止并保存", "Saving…": "正在保存…", "Open camera": "打开相机", "Close camera": "关闭相机", "Drag & drop or click to choose": "拖放文件或点击选择", "Free plan": "免费套餐", "Log out": "退出登录", "Change username": "修改用户名", "Update username": "更新用户名", "Username updated.": "用户名已更新。", "Record": "录制", "Community discussion": "社区讨论", "Upload date": "上传日期", "Done selecting": "完成选择", "Select": "选择", "Uploads": "上传内容", "Unknown size": "未知大小", "Delete upload": "删除上传文件", "Delete uploads?": "删除上传文件？", "This file": "此文件", "This file will be permanently deleted.": "此文件将被永久删除。", "Sort uploads": "排序上传内容", "Delete permanently": "永久删除", "Deleting…": "正在删除…", "Delete in": "将在以下时间后删除", "Couldn't load uploads. Please try again.": "无法加载上传内容，请重试。", "Couldn't delete the selected upload. Please try again.": "无法删除所选上传文件，请重试。", "Couldn't delete this persona. Please try again.": "无法删除此人格，请重试。", "Couldn't finish persona setup. Please try again.": "无法完成人格设置，请重试。", "Couldn't discard this draft. Please try again.": "无法放弃此草稿，请重试。", "Couldn't load community messages. Please try again shortly.": "无法加载社区消息，请稍后重试。", "Couldn't send your message. Please try again.": "无法发送您的消息，请重试。",
  "Public Instagram, Facebook, X, YouTube, or Xiaohongshu profile": "公开的 Instagram、Facebook、X、YouTube 或小红书主页", "Add": "添加", "Delete selected": "删除所选内容", "Saves a note of what's publicly visible on the profile page (name, bio) as a file alongside your other uploads — not the account's posts or photos.": "会将主页中公开可见的信息（名称、简介）作为文件保存，与其他上传内容放在一起；不会读取账户的帖子或照片。",
  "This permanently deletes this persona, every upload, and its complete chat history. This cannot be undone.": "这将永久删除该人格、所有上传文件和完整聊天记录。此操作无法撤销。", "Add to this persona at any time. Your existing chat history and uploads are kept.": "您可以随时向此人格添加内容。现有聊天记录和上传文件会被保留。",
  "Free access": "免费使用", "Expiry date:": "截止日期：",
  "Start when you are ready. It saves when you stop or when time runs out.": "准备好后即可开始。停止录制或时间结束时将自动保存。", "Start when you are ready. The scan saves when you stop or when time runs out.": "准备好后即可开始。停止扫描或时间结束时将自动保存。", "Start when you are ready. It saves a face reference and a motion clip when you stop or when time runs out.": "准备好后即可开始。停止扫描或时间结束时会保存面部参考图和动态片段。", "Up to 3 MP4 or MOV videos, 20 MB each": "最多 3 个 MP4 或 MOV 视频，每个最大 20 MB", "Up to 3 camera videos, 15 seconds each — prepared as MP4 for avatar training": "最多 3 段相机视频，每段最长 15 秒——将转换为 MP4 用于虚拟形象训练", "One voice recording per persona — normalized to WAV for voice training": "每个人格可录制一段声音——将转换为 WAV 用于音色训练", "This upload type needs a subscription.": "此上传类型需要订阅。", "Couldn't reach the server.": "无法连接服务器。", "Couldn't reach the server. Check your connection and try again.": "无法连接服务器。请检查网络后重试。", "A new confirmation code is on its way.": "新的验证码正在发送。", "Camera permission was denied.": "相机权限被拒绝。", "Camera or microphone access was denied.": "相机或麦克风权限被拒绝。", "Microphone access was denied or recording is unavailable.": "麦克风权限被拒绝，或录制功能不可用。", "No audio was captured. Please try again.": "未录制到音频，请重试。", "Camera is still starting. Please try again in a moment.": "相机仍在启动中，请稍后重试。", "Couldn't capture the facial scan. Please try again.": "无法捕捉面部扫描，请重试。", "Couldn't save the facial motion scan. Please try again.": "无法保存面部动态扫描，请重试。", "Couldn't transcribe that speech. Please try again.": "无法转写这段语音，请重试。", "Couldn't capture audio with this recording. Please check your microphone and try again.": "无法在此次录制中捕捉到音频，请检查麦克风后重试。",
  "One 40-second guided scan per persona — re-scanning replaces it": "每个人格可保存一次 40 秒引导式扫描——重新扫描会替换原扫描", "One 20-second natural-motion scan per persona — re-scanning replaces it": "每个人格可保存一次 20 秒自然动态扫描——重新扫描会替换原扫描", "Look toward the camera and stay relaxed. Blink, breathe, and make small natural movements without speaking.": "请看向镜头并保持放松。自然眨眼、呼吸并做轻微动作，无需说话。", "Couldn't save the passive facial scan. Please try again.": "无法保存自然动态面部扫描，请重试。", "Recording with talking": "说话录制", "One 40-second recording of you talking — captures video and voice together; re-recording replaces it": "每个人格可保存一段 40 秒的说话录制——同时捕捉画面与声音；重新录制会替换原录制", "Start when you are ready. It saves a face reference and a video-and-voice recording when you stop or when time runs out.": "准备好后即可开始。停止录制或时间结束时，会保存面部参考图以及包含画面与声音的录制内容。", "Add source material to enable live video. Chat remains available.": "添加素材以启用实时视频。文字聊天仍可使用。",
  "Month": "月度", "Season": "季度", "Year": "年度", "mo": "月", "3 months": "3 个月", "yr": "年", "Community": "社区", "Live discussion with the ECHO community. Messages disappear after 24 hours.": "与 ECHO 社区实时交流。消息会在 24 小时后消失。", "15s between messages": "消息发送间隔 15 秒", "No community messages yet. Start the conversation.": "尚无社区消息。开始这段对话吧。", "Write a message to the community": "写一条社区消息", "Send": "发送", "Persona appearance": "人格外观", "Choose the future live-video style. This cannot be changed after the persona is created.": "选择未来实时视频的风格。人格创建后无法修改。", "Realistic": "写实", "Cartoon": "卡通", "Speech language": "语音语言", "Chooses the language and recognition model used for live speech.": "选择实时语音使用的语言和识别模型。", "Mandarin": "普通话", "Wu Dialect": "江浙沪方言", "English": "英语", "Meet our Non-Profit": "认识我们的非营利组织", "ECHO Companionship for Hospice Organisations": "ECHO 临终关怀机构陪伴计划", "Co-Founder": "联合创始人", "Coming soon": "即将公布",
  "Messages are limited to 10 lines.": "消息最多只能发送 10 行。",
};

const translatedAttributes = new Set(["placeholder", "aria-label", "title"]);
const originalTextByNode = new WeakMap<Text, string>();
const originalAttributesByElement = new WeakMap<Element, Map<string, string>>();

function translateEnglishToChinese(value: string) {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  const direct = zh[core];
  if (direct) return `${leading}${direct}${trailing}`;
  if (core.startsWith("Purchase ")) return `${leading}购买 ${core.slice("Purchase ".length)}${trailing}`;
  if (core.startsWith("Preparing ")) return `${leading}正在准备 ${core.slice("Preparing ".length)}${trailing}`;
  if (core.startsWith("Message ")) return `${leading}向 ${core.slice("Message ".length)} 发送消息${trailing}`;
  const resend = core.match(/^Resend code in (\d+)s$/);
  if (resend) return `${leading}${resend[1]} 秒后重新发送验证码${trailing}`;
  const sentTo = core.match(/^Enter the six-character code we sent to (.+)\.$/);
  if (sentTo) return `${leading}请输入我们发送至 ${sentTo[1]} 的六码验证码。${trailing}`;
  if (core === "Enter the six-character code we sent to") return `${leading}请输入我们发送至${trailing}`;
  const accountSettings = core.match(/^(.+) — Account settings$/);
  if (accountSettings) return `${leading}${accountSettings[1]} — 账户设置${trailing}`;
  const recordVoice = core.match(/^Record (.+)'s voice$/);
  if (recordVoice) return `${leading}录制 ${recordVoice[1]} 的声音${trailing}`;
  const scanFace = core.match(/^Scan (.+)'s face$/);
  if (scanFace) return `${leading}扫描 ${scanFace[1]} 的面部${trailing}`;
  const guidedScan = core.match(/^Guided scan for (.+)$/);
  if (guidedScan) return `${leading}${guidedScan[1]} 的引导式扫描${trailing}`;
  const recordingWithTalking = core.match(/^Recording with talking for (.+)$/);
  if (recordingWithTalking) return `${leading}${recordingWithTalking[1]} 的说话录制${trailing}`;
  const recordingTimer = core.match(/^Recording — (\d+)s remaining$/);
  if (recordingTimer) return `${leading}正在录制 — 剩余 ${recordingTimer[1]} 秒${trailing}`;
  const scanningTimer = core.match(/^Scanning — (\d+)s remaining$/);
  if (scanningTimer) return `${leading}正在扫描 — 剩余 ${scanningTimer[1]} 秒${trailing}`;
  const naturalScanningTimer = core.match(/^Scanning natural movement — (\d+)s remaining$/);
  if (naturalScanningTimer) return `${leading}正在扫描自然动作 — 剩余 ${naturalScanningTimer[1]} 秒${trailing}`;
  const stopSave = core.match(/^Stop & save \((\d+)s\)$/);
  if (stopSave) return `${leading}停止并保存（${stopSave[1]} 秒）${trailing}`;
  const audioLimit = core.match(/^Up to (\d+) MP3 or WAV files, 1 MB each$/);
  if (audioLimit) return `${leading}最多 ${audioLimit[1]} 个 MP3 或 WAV 音频文件，每个最大 1 MB${trailing}`;
  const photoLimit = core.match(/^Up to (\d+) JPG or PNG photos, 5 MB each$/);
  if (photoLimit) return `${leading}最多 ${photoLimit[1]} 张 JPG 或 PNG 照片，每张最大 5 MB${trailing}`;
  const documentLimit = core.match(/^Up to (\d+) PDF, TXT, or DOCX documents, 5 MB each$/);
  if (documentLimit) return `${leading}最多 ${documentLimit[1]} 个 PDF、TXT 或 DOCX 文档，每个最大 5 MB${trailing}`;
  const savedVideos = core.match(/^(\d+) saved — record more$/);
  if (savedVideos) return `${leading}已保存 ${savedVideos[1]} 个 — 继续录制${trailing}`;
  const addedFiles = core.match(/^(\d+) added — add more$/);
  if (addedFiles) return `${leading}已添加 ${addedFiles[1]} 个 — 继续添加${trailing}`;
  const selectUpload = core.match(/^Select (.+)$/);
  if (selectUpload) return `${leading}选择 ${selectUpload[1]}${trailing}`;
  const managePersona = core.match(/^Manage (.+)$/);
  if (managePersona) return `${leading}管理 ${managePersona[1]}${trailing}`;
  const deletePersona = core.match(/^Delete (.+)\?$/);
  if (deletePersona) return `${leading}删除 ${deletePersona[1]}？${trailing}`;
  const deleteAfter = core.match(/^Delete in (\d+)s$/);
  if (deleteAfter) return `${leading}${deleteAfter[1]} 秒后可删除${trailing}`;
  const uploadLimit = core.match(/^You've reached this persona's limit of (\d+) (.+)\. Delete an existing file to add another\.$/);
  if (uploadLimit) return `${leading}此人格的${uploadLimit[2]}上限为 ${uploadLimit[1]} 个。请删除现有文件后再添加。${trailing}`;
  const remainingUploads = core.match(/^You can add (\d+) more (.+) file(?:s)?\. Choose no more than (\d+) at once\.$/);
  if (remainingUploads) return `${leading}还可以添加 ${remainingUploads[1]} 个${remainingUploads[2]}文件；一次最多选择 ${remainingUploads[3]} 个。${trailing}`;
  const oversizeFile = core.match(/^(.+) is larger than the (\d+) MB limit\.$/);
  if (oversizeFile) return `${leading}${oversizeFile[1]} 超过了 ${oversizeFile[2]} MB 的大小限制。${trailing}`;
  const deleteFiles = core.match(/^(\d+) files will be permanently deleted\.$/);
  if (deleteFiles) return `${leading}${deleteFiles[1]} 个文件将被永久删除。${trailing}`;
  const avatarServer = core.match(/^Avatar server returned (\d+)\.$/);
  if (avatarServer) return `${leading}虚拟形象服务器返回了 ${avatarServer[1]} 错误。${trailing}`;
  const sendCooldown = core.match(/^Send in (\d+)s$/);
  if (sendCooldown) return `${leading}${sendCooldown[1]} 秒后可发送${trailing}`;
  const hello = core.match(/^Say hello to (.+)\.$/);
  if (hello) return `${leading}向 ${hello[1]} 问好。${trailing}`;
  const cannedEcho = core.match(/^\((.+) isn't connected to a real AI yet — this is a canned echo\) You said: "([\s\S]*)"$/);
  if (cannedEcho) return `${leading}（${cannedEcho[1]} 尚未接入真实的 AI——这是预设回复。）你说：“${cannedEcho[2]}”${trailing}`;
  const discount = core.match(/^Save (\d+)%$/);
  if (discount) return `${leading}优惠 ${discount[1]}%${trailing}`;
  return value;
}

function translateTree(root: Node, locale: "en" | "zh") {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parent.tagName)) continue;
    const stored = originalTextByNode.get(node);
    // React may reuse a text node when data changes. If it has re-rendered a
    // fresh source string, record that source; if it is merely our existing
    // Chinese display, retain the original English source.
    const original = !stored || (node.data !== stored && node.data !== translateEnglishToChinese(stored))
      ? node.data
      : stored;
    originalTextByNode.set(node, original);
    const next = locale === "zh" ? translateEnglishToChinese(original) : original;
    if (next !== node.data) node.data = next;
  }
  if (!(root instanceof Element)) return;
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of translatedAttributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      let originals = originalAttributesByElement.get(element);
      if (!originals) {
        originals = new Map<string, string>();
        originalAttributesByElement.set(element, originals);
      }
      const stored = originals.get(attribute);
      const original = !stored || (value !== stored && value !== translateEnglishToChinese(stored)) ? value : stored;
      originals.set(attribute, original);
      const next = locale === "zh" ? translateEnglishToChinese(original) : original;
      if (next !== value) element.setAttribute(attribute, next);
    }
  }
}

export function LocaleTextTranslator() {
  const { locale } = useLocale();

  // useLayoutEffect, not useEffect: this must commit the translated DOM in
  // the same paint as LanguageToggle's flag re-render. A passive effect
  // lands a frame (or, given the full-tree TreeWalker pass below, longer)
  // after the flag has already flipped, which is exactly what showed up as
  // the flag and page content briefly disagreeing right after load.
  useLayoutEffect(() => {
    let translating = false;
    const apply = (root: Node) => {
      translating = true;
      translateTree(root, locale);
      translating = false;
    };
    apply(document.body);
    const observer = new MutationObserver((mutations) => {
      if (translating) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") apply(mutation.target);
        else for (const node of mutation.addedNodes) apply(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}
