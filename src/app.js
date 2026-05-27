import express from "express";
import { authrouter } from "./routes/auth.routes.js";
import cors from 'cors'
import cookieParser from "cookie-parser";
import { courseRouter } from "./routes/course.routes.js";

const app = express();

app.use(express.json());
app.use(cors())
app.use(cookieParser());

app.use('/auth', authrouter)
app.use("/courses", courseRouter);
export { app };