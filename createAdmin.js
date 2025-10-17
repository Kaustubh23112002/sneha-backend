import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./models/User.js";

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Delete existing admin to avoid conflict
    await User.deleteOne({ email: "admin@gmail.com" });

    const admin = new User({
      fullName: "Admin User",
      email: "admin@gmail.com",
      password: "admin123",
      phoneNumber: "9999999999",
      address: "Admin Office",
      salary: "0",
      role: "admin",
      shiftTimings: [],
    });

    await admin.save();

    console.log("✅ Admin created: email=admin@gmail.com password=admin123");
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Error creating admin:", err);
    process.exit(1);
  }
};

createAdmin();
