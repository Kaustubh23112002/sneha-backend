// middleware/upload.js
import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../utils/cloudinary.js";

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "attendance_photos",
    allowed_formats: ["jpg", "jpeg", "png"]
  }
});

const parser = multer({ storage: storage });

export default parser;
