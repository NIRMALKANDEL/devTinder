// Added: demo data for local development and UI testing (never run against production)
const bcrypt = require("bcryptjs");
const { User } = require("../src/models/user");
const { connectionRequest } = require("../src/models/connectionRequest");

const PASSWORD = "Dev@12345";

const people = [
  { firstName: "Aarav", lastName: "Sharma", emailId: "aarav@example.com", age: 27, gender: "male", skills: ["React", "Node.js", "MongoDB"], about: "Full-stack dev who loves shipping side projects on weekends." },
  { firstName: "Priya", lastName: "Verma", emailId: "priya@example.com", age: 25, gender: "female", skills: ["Python", "Django", "React"], about: "Backend engineer, open-source contributor, chai enthusiast." },
  { firstName: "Rohan", lastName: "Mehta", emailId: "rohan@example.com", age: 30, gender: "male", skills: ["Go", "Kubernetes", "AWS"], about: "Platform engineer. I make deploys boring." },
  { firstName: "Sneha", lastName: "Iyer", emailId: "sneha@example.com", age: 24, gender: "female", skills: ["Figma", "React", "Three.js"], about: "Design engineer building delightful interfaces." },
  { firstName: "Kabir", lastName: "Singh", emailId: "kabir@example.com", age: 29, gender: "male", skills: ["Rust", "WebAssembly"], about: "Systems programmer exploring Rust on the web." },
  { firstName: "Ananya", lastName: "Rao", emailId: "ananya@example.com", age: 26, gender: "female", skills: ["Flutter", "Firebase", "Node.js"], about: "Mobile dev looking for a co-founder." },
];

const seed = async () => {
  const password = await bcrypt.hash(PASSWORD, 10);
  const users = await User.insertMany(
    people.map((p) => ({ ...p, password, isEmailVerified: true, photoURL: `https://i.pravatar.cc/400?u=${p.emailId}` }))
  );
  const [aarav, priya, rohan, sneha] = users;
  // Aarav <-> Priya connected, Rohan -> Aarav pending, Sneha -> Aarav pending
  await connectionRequest.create([
    { fromUserId: aarav._id, toUserId: priya._id, status: "accepted" },
    { fromUserId: rohan._id, toUserId: aarav._id, status: "interested" },
    { fromUserId: sneha._id, toUserId: aarav._id, status: "interested" },
  ]);
  return { users, password: PASSWORD };
};

module.exports = { seed, PASSWORD };
