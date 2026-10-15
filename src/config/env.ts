import dotenv from 'dotenv';
import { parseEnvironment, type Environment } from '../schemas/env.schema.js';

export function loadEnvironment(): Environment {
  dotenv.config();
  return parseEnvironment(process.env);
}