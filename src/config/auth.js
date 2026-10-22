import 'dotenv/config';
export function secret(){const value=process.env.JWT_SECRET;if(!value||value.length<32||value.startsWith('replace-'))throw new Error('Đặt JWT_SECRET ngẫu nhiên tối thiểu 32 ký tự trong .env');return value;}
