import 'dotenv/config';
import mongoose from 'mongoose';
import RiskModel from './models/RiskModel.js';
await mongoose.connect(process.env.MONGO_URI);
const models = await RiskModel.find({}, { hazardType:1, version:1, isActive:1, createdAt:1, metrics:1, operatingThreshold:1 }).sort({ createdAt: -1 }).lean();
console.log(JSON.stringify(models, null, 2));
await mongoose.disconnect();
