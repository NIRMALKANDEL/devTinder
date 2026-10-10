const cron = require('node-cron');
const { subDays, startOfDay, format } = require('date-fns');
const sendEmail = require('./sendEmail');
const { connectionRequest } = require('../models/connectionRequest');

// Every day at 08:00, email each user a digest of the connection requests
// they received yesterday and haven't answered yet
const sendPendingRequestDigests = async () => {
    const today = startOfDay(new Date());
    const yesterday = subDays(today, 1);

    const requests = await connectionRequest.find({
        status: 'interested',
        createdAt: { $gte: yesterday, $lt: today }
    })
    .populate('fromUserId', 'firstName lastName')
    .populate('toUserId', 'firstName emailId');

    // Group by recipient; skip requests whose users were deleted
    const byRecipient = new Map();
    for (const request of requests) {
        if (!request.fromUserId || !request.toUserId) continue;
        const recipientId = String(request.toUserId._id);
        if (!byRecipient.has(recipientId)) {
            byRecipient.set(recipientId, { toUser: request.toUserId, senderNames: [] });
        }
        byRecipient.get(recipientId).senderNames.push(sendEmail.fullName(request.fromUserId));
    }

    const results = sendEmail.sendPendingRequestsDigests(
        [...byRecipient.values()],
        format(yesterday, 'yyyy-MM-dd')
    );
    const queued = results.filter((r) => r.queued).length;
    console.log(`[cron] queued ${queued}/${results.length} pending-request digest emails`);
};

cron.schedule('0 8 * * *', async () => {
    try {
        await sendPendingRequestDigests();
    } catch (err) {
        console.error('[cron] pending-request digest failed:', err.message);
    }
});

module.exports = { sendPendingRequestDigests };
