const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: [true, "First name is required"],
      minlength: [2, "First name must be at least 2 characters"],
      maxlength: [50, "First name cannot exceed 50 characters"],
      trim: true,
    },
    lastName: {
      type: String,
      minlength: [2, "Last name must be at least 2 characters"],
      maxlength: [50, "Last name cannot exceed 50 characters"],
      trim: true,
    },
    emailId: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
        "Invalid email format",
      ],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters long"],
      maxlength: [128, "Password cannot exceed 128 characters"],
    },
    age: {
      type: Number,
      required: [true, "Age is required"],
      min: [18, "You must be at least 18 years old"],
      max: [100, "Age cannot be greater than 100"],
    },
    gender: {
      type: String,
      required: [true, "Gender is required"],
      enum: {
        values: ["male", "female", "others"],
        message: "Gender must be 'male', 'female', or 'others'",
      },
    },
    photoURL: {
      type: String,
      default:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS0rz7SHvHoyn3LwaQ6Zc8LkQEmi-ClP8mvZg&s",
      match: [
        /^(https?:\/\/.*\.(?:png|jpg|jpeg|gif|svg|webp))$/,
        "Invalid image URL format",
      ],
    },
    about: {
      type: String,
      default: "This is the default about section of the user",
      maxlength: [500, "About section cannot exceed 500 characters"],
    },
    skills: {
      type: [String],
      validate: {
        validator: function (skills) {
          return skills.length <= 10;
        },
        message: "A user can have a maximum of 10 skills",
      },
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

module.exports = { User };
